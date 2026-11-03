import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { validateEnvironment } from "./config.mjs";

const errors = validateEnvironment(process.env);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
// Never load the exported project's hosted .env into a standalone browser bundle.
const env = { ...process.env, FIELD_OPS_STANDALONE: "1" };
delete env.LOVABLE_NITRO_PRESET;
const result = spawnSync("bun", ["x", "vite", "build", "--config", "vite.standalone.config.ts"], { env, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
if (!existsSync(".output/server/index.mjs")) {
  console.error("Node server output is missing. Build this deployment outside the Lovable sandbox.");
  process.exit(1);
}
mkdirSync(".output", { recursive: true });
// Contains public configuration only; used to reject stale builds at startup.
writeFileSync(".output/standalone.json", JSON.stringify({ publicUrl: env.VITE_SUPABASE_URL, publicKey: env.VITE_SUPABASE_PUBLISHABLE_KEY }));