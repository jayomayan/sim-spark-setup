import postgres from "postgres";
import type { DbConnectionCredentials } from "./db-connection.server";

// A separate namespace prevents setup from altering unrelated tables on an existing server.
export const EXTERNAL_SCHEMA = "field_ops";
export const EXTERNAL_SCHEMA_VERSION = 1;
export const REQUIRED_TABLES = ["profiles", "user_roles", "devices", "sim_activations", "agent_jobs", "agent_status", "database_connections"] as const;

const TABLE_DEFINITIONS = [
  `CREATE TABLE IF NOT EXISTS field_ops.profiles (
    id uuid PRIMARY KEY, email text, display_name text,
    created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS field_ops.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'operator')), UNIQUE (user_id, role))`,
  `CREATE TABLE IF NOT EXISTS field_ops.devices (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ip text NOT NULL UNIQUE,
    site_id text, name text, serial_number text UNIQUE, arm_version text,
    stm32_version text, web_version text, kernel_version text, mib_version text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS field_ops.sim_activations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), iccid text NOT NULL, ip text,
    status text NOT NULL DEFAULT 'running', error text, simulated boolean NOT NULL DEFAULT false,
    created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz)`,
  `CREATE TABLE IF NOT EXISTS field_ops.agent_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'queued',
    result jsonb, error text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz, finished_at timestamptz)`,
  `CREATE TABLE IF NOT EXISTS field_ops.agent_status (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1), last_seen timestamptz, version text, hostname text)`,
  `CREATE TABLE IF NOT EXISTS field_ops.database_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL, host text NOT NULL,
    port integer NOT NULL DEFAULT 5432, database_name text NOT NULL DEFAULT 'postgres',
    username text NOT NULL, password_cipher text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
];

export type DatabaseSetupResult = {
  ok: boolean;
  message: string;
  databaseCreated: boolean;
  tablesCreated: string[];
  schemaVersion: number | null;
};

function connect(creds: DbConnectionCredentials, database = creds.database) {
  return postgres({ ...creds, database, max: 1, connect_timeout: 8, idle_timeout: 8,
    prepare: false, fetch_types: false, connection: { statement_timeout: 15000, lock_timeout: 10000 } });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

function setupError(error: unknown): string {
  switch (errorCode(error)) {
    case "42501": return "This account needs permission to create the database, schema and tables. Ask your database administrator to grant setup permissions, then retry.";
    case "28P01": case "28000": return "The database server rejected the username or password.";
    case "ENOTFOUND": case "EAI_AGAIN": return "Couldn't find the database server. Check the host.";
    case "ECONNREFUSED": return "The database server refused the connection. Check the host, port and network access.";
    case "CONNECT_TIMEOUT": case "ETIMEDOUT": case "57014": case "55P03": return "Database setup timed out. Check server availability, then retry.";
    case "3D000": return "Couldn't reach the maintenance database 'postgres' to create the requested database. Ask your database administrator to create it, then retry.";
    default: return "Database setup couldn't finish. Existing data was not deleted. Check server permissions and compatibility, then retry.";
  }
}

export async function initializeExternalDatabase(creds: DbConnectionCredentials): Promise<DatabaseSetupResult> {
  let databaseCreated = false;
  let sql = connect(creds);
  try {
    try {
      await sql`SELECT 1`;
    } catch (error) {
      if (errorCode(error) !== "3D000") throw error;
      await sql.end({ timeout: 2 }).catch(() => undefined);
      const maintenance = connect(creds, "postgres");
      try {
        // Database identifiers are quoted by postgres, never interpolated as raw SQL.
        try {
          await maintenance`CREATE DATABASE ${maintenance(creds.database)}`;
          databaseCreated = true;
        } catch (creationError) {
          if (errorCode(creationError) !== "42P04") throw creationError;
        }
      } finally {
        await maintenance.end({ timeout: 2 }).catch(() => undefined);
      }
      sql = connect(creds);
    }

    const tablesCreated = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(614289037)`;
      await tx`CREATE SCHEMA IF NOT EXISTS field_ops`;
      await tx`REVOKE ALL ON SCHEMA field_ops FROM PUBLIC`;
      const existing = await tx<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'field_ops'`;
      if (existing.length && !existing.some((row) => row.table_name === "schema_migrations")) {
        throw new Error("Unrecognized existing schema");
      }
      await tx`CREATE TABLE IF NOT EXISTS field_ops.schema_migrations (
        version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
      const applied = await tx<{ version: number }[]>`SELECT version FROM field_ops.schema_migrations ORDER BY version DESC LIMIT 1`;
      if (applied[0] && applied[0].version !== EXTERNAL_SCHEMA_VERSION) throw new Error("Unsupported schema version");
      const created = REQUIRED_TABLES.filter((name) => !existing.some((row) => row.table_name === name));
      for (const definition of TABLE_DEFINITIONS) await tx.unsafe(definition);
      await tx`CREATE INDEX IF NOT EXISTS agent_jobs_status_created_at_idx ON field_ops.agent_jobs (status, created_at)`;
      await tx`INSERT INTO field_ops.agent_status (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
      await tx`INSERT INTO field_ops.schema_migrations (version) VALUES (${EXTERNAL_SCHEMA_VERSION}) ON CONFLICT DO NOTHING`;
      const [account] = await tx<{ username: string }[]>`SELECT current_user AS username`;
      if (!account) throw new Error("Database account unavailable");
      await tx`GRANT USAGE ON SCHEMA field_ops TO ${tx(account.username)}`;
      for (const name of [...REQUIRED_TABLES, "schema_migrations"]) {
        await tx`REVOKE ALL ON TABLE ${tx(`${EXTERNAL_SCHEMA}.${name}`)} FROM PUBLIC`;
        await tx`GRANT ALL ON TABLE ${tx(`${EXTERNAL_SCHEMA}.${name}`)} TO ${tx(account.username)}`;
        // No browser or generic authenticated role is granted access. Only the owner
        // can access these staged tables until a separately authorized cutover.
        await tx`ALTER TABLE ${tx(`${EXTERNAL_SCHEMA}.${name}`)} ENABLE ROW LEVEL SECURITY`;
      }
      await tx`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA field_ops TO ${tx(account.username)}`;
      return [...created];
    });
    return { ok: true, databaseCreated, tablesCreated, schemaVersion: EXTERNAL_SCHEMA_VERSION,
      message: `${databaseCreated ? "Database created" : "Database connected"} — ${tablesCreated.length ? `${tablesCreated.length} required tables created` : "required tables already ready"}. Existing data is unchanged; the app still uses Lovable Cloud.` };
  } catch (error) {
    return { ok: false, databaseCreated, tablesCreated: [], schemaVersion: null,
      message: `${setupError(error)}${databaseCreated ? " The new database was created, but table setup was rolled back; retry to finish." : ""}` };
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}