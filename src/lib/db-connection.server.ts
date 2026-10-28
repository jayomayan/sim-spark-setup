import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type DbConnectionCredentials = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
};

export type ConnectionTestResult = { ok: boolean; message: string; latencyMs: number };

function encryptionKey(): Buffer {
  const secret = process.env["DB_SECRET_KEY"];
  if (!secret) throw new Error("Credential encryption isn't configured on the server");
  return createHash("sha256").update(secret).digest();
}

export function encryptPassword(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

export function decryptPassword(cipher: string): string {
  const [ivHex, tagHex, dataHex] = cipher.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Stored credential is malformed");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

function describeDbError(error: unknown, creds: DbConnectionCredentials): string {
  const err = error as { code?: string; message?: string };
  const message = err.message ?? "";
  switch (err.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `Couldn't resolve the host "${creds.host}".`;
    case "ECONNREFUSED":
      return `Connection refused — nothing is accepting connections on ${creds.host}:${creds.port}.`;
    case "ETIMEDOUT":
      return `Connection to ${creds.host}:${creds.port} timed out.`;
    case "28P01":
      return "Server reached, but the password was rejected.";
    case "28000":
      return "Server reached, but the username was rejected.";
    case "3D000":
      return `Server reached, but the database "${creds.database}" doesn't exist.`;
    case "42501":
      return "Server reached, but this account isn't allowed to read from it.";
    default:
      break;
  }
  if (/password authentication/i.test(message)) return "Server reached, but the password was rejected.";
  if (/too many connections/i.test(message)) return "Server reached, but it has no free connections left.";
  return message ? `Connection failed: ${message}` : "Connection failed.";
}

export async function testDbConnection(
  creds: DbConnectionCredentials,
  timeoutSeconds = 8,
): Promise<ConnectionTestResult> {
  const started = Date.now();
  try {
    const postgres = (await import("postgres")).default;
    const sql = postgres({
      host: creds.host,
      port: creds.port,
      database: creds.database,
      username: creds.username,
      password: creds.password,
      max: 1,
      connect_timeout: timeoutSeconds,
      idle_timeout: timeoutSeconds,
      prepare: false,
      fetch_types: false,
    });
    try {
      const rows = (await sql`select version() as version`) as { version?: unknown }[];
      const raw = rows[0]?.version ? String(rows[0].version) : "";
      const version = raw.split(" (")[0] || "Connected";
      return { ok: true, message: version, latencyMs: Date.now() - started };
    } finally {
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }
  } catch (error) {
    return { ok: false, message: describeDbError(error, creds), latencyMs: Date.now() - started };
  }
}
