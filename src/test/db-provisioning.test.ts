import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("postgres", () => ({ default: mock.connect }));
import { initializeExternalDatabase, REQUIRED_TABLES } from "../lib/db-provisioning.server";

const credentials = { host: "test.invalid", port: 5432, database: "new_field_ops", username: "setup_user", password: "" };
function client(options: { missing?: boolean; existing?: boolean; fail?: string } = {}) {
  const statements: string[] = [];
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray | string) => {
    if (typeof parts === "string") return parts;
    const text = parts.join("?"); statements.push(text);
    if (options.missing && text === "SELECT 1") throw { code: "3D000" };
    if (options.fail && text.includes("CREATE DATABASE")) throw { code: options.fail };
    if (text.includes("information_schema.tables")) return options.existing ? [...REQUIRED_TABLES, "schema_migrations"].map((table_name) => ({ table_name })) : [];
    if (text.includes("SELECT version")) return options.existing ? [{ version: 1 }] : [];
    if (text.includes("current_user")) return [{ username: "setup_user" }];
    return [];
  }), {
    end: vi.fn(async () => {}),
    unsafe: vi.fn(async (text: string) => { statements.push(text); return []; }),
    begin: vi.fn(),
  });
  sql.begin.mockImplementation(async (fn) => fn(sql));
  return { sql, statements };
}
afterEach(() => vi.clearAllMocks());
describe("external database setup", () => {
  it("creates a missing named database before its required tables", async () => {
    const target = client({ missing: true }); const maintenance = client(); const fresh = client();
    mock.connect.mockReturnValueOnce(target.sql).mockReturnValueOnce(maintenance.sql).mockReturnValueOnce(fresh.sql);
    const result = await initializeExternalDatabase(credentials);
    expect(result.ok).toBe(true);
    expect(result.databaseCreated).toBe(true);
    expect(result.tablesCreated).toEqual(["profiles", "user_roles", "devices", "sim_activations", "agent_jobs", "agent_status", "database_connections"]);
    expect(maintenance.statements.some((text) => text.startsWith("CREATE DATABASE"))).toBe(true);
    expect(mock.connect.mock.calls[1]?.[0].database).toBe("postgres");
    expect(fresh.sql.begin).toHaveBeenCalledOnce();
  });
  it("repeat setup preserves existing tables without creating another database", async () => {
    const existing = client({ existing: true }); mock.connect.mockReturnValue(existing.sql);
    const result = await initializeExternalDatabase(credentials);
    expect(result.ok).toBe(true); expect(result.tablesCreated).toEqual([]); expect(result.databaseCreated).toBe(false);
    expect(existing.statements.some((text) => /DROP|TRUNCATE|DELETE/.test(text))).toBe(false);
    expect(mock.connect).toHaveBeenCalledOnce();
  });
  it("returns a permission failure without attempting table setup", async () => {
    const target = client({ missing: true }); const maintenance = client({ fail: "42501" });
    mock.connect.mockReturnValueOnce(target.sql).mockReturnValueOnce(maintenance.sql);
    const result = await initializeExternalDatabase(credentials);
    expect(result.ok).toBe(false); expect(result.databaseCreated).toBe(false); expect(result.tablesCreated).toEqual([]);
    expect(maintenance.sql.begin).not.toHaveBeenCalled();
  });
  it("excludes retired router logs and does not clone managed auth or grant public access", async () => {
    const target = client(); mock.connect.mockReturnValue(target.sql);
    await initializeExternalDatabase(credentials);
    const ddl = target.statements.join(";");
    expect(ddl).not.toMatch(/device_logs|last_log_pulled_at|auth\.users|CREATE ROLE|TO authenticated|TO PUBLIC/i);
    expect(ddl).toContain("REVOKE ALL ON SCHEMA field_ops FROM PUBLIC");
    expect(target.statements.filter((text) => text.includes("ENABLE ROW LEVEL SECURITY"))).toHaveLength(8);
  });
});