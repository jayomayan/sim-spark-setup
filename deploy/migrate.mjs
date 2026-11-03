import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import postgres from "postgres";

// Run only against a NEW independently operated backend. Never prints connection details.
if (!process.env.STANDALONE_DATABASE_URL || process.env.FIELD_OPS_STANDALONE !== "1") {
  console.error("Set STANDALONE_DATABASE_URL and FIELD_OPS_STANDALONE=1 for the independent backend.");
  process.exit(1);
}
const destination = new URL(process.env.STANDALONE_DATABASE_URL);
if (destination.hostname.endsWith(".supabase.co") || destination.hostname.endsWith(".supabase.com")) {
  console.error("Refusing to migrate the hosted backend."); process.exit(1);
}
const sql = postgres(process.env.STANDALONE_DATABASE_URL, { max: 1, prepare: false });
try {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(803411790)`;
    const [prerequisite] = await tx`SELECT to_regclass('auth.users') IS NOT NULL AS ready`;
    if (!prerequisite?.ready) throw new Error("Initialize the independent authentication/data stack first; plain PostgreSQL is not sufficient.");
    const roles = await tx`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`;
    if (roles.length !== 3) throw new Error("Required data API roles are missing.");
    const [state] = await tx`SELECT to_regclass('field_ops_deploy.migrations') IS NOT NULL AS tracked, to_regclass('public.profiles') IS NOT NULL AS existing`;
    if (state?.existing && !state.tracked) throw new Error("Existing application schema detected. Reconcile a restored database manually; fresh migrations will not overwrite it.");
    await tx.unsafe("CREATE SCHEMA IF NOT EXISTS field_ops_deploy; REVOKE ALL ON SCHEMA field_ops_deploy FROM PUBLIC; CREATE TABLE IF NOT EXISTS field_ops_deploy.migrations (tag text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON field_ops_deploy.migrations FROM PUBLIC;");
    const journal = JSON.parse(readFileSync("drizzle/migrations/meta/_journal.json", "utf8"));
    for (const { tag } of journal.entries) {
      if (!/^\d{4}_[a-z_]+$/.test(tag)) throw new Error("Invalid migration tag");
      const source = readFileSync(`drizzle/migrations/${tag}.sql`, "utf8");
      const checksum = createHash("sha256").update(source).digest("hex");
      const [applied] = await tx`SELECT checksum FROM field_ops_deploy.migrations WHERE tag = ${tag}`;
      if (applied && applied.checksum !== checksum) throw new Error(`Applied migration changed: ${tag}`);
      if (applied) continue;
      await tx.unsafe(source);
      await tx`INSERT INTO field_ops_deploy.migrations (tag, checksum) VALUES (${tag}, ${checksum})`;
      console.log(`Applied ${tag}`);
    }
    // Existing identity-backed device writes need sequence privileges on fresh stacks.
    await tx.unsafe("GRANT USAGE ON SCHEMA public TO authenticated, service_role; GRANT USAGE, SELECT ON SEQUENCE public.devices_id_seq TO authenticated; GRANT ALL ON SEQUENCE public.devices_id_seq TO service_role; NOTIFY pgrst, 'reload schema';");
  });
  console.log("Standalone application migrations committed.");
} catch (error) {
  // Database exception details can contain connection data; emit safe guidance only.
  console.error(error instanceof Error && /^(Initialize|Required|Existing|Applied|Invalid)/.test(error.message) ? error.message : "Migration failed and rolled back. Check backend readiness, owner permissions and server-side database diagnostics privately.");
  process.exitCode = 1;
} finally { await sql.end(); }