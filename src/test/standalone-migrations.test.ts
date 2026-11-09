import { afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ statements: [] as string[], applied: false, restored: false, close: vi.fn(), begin: vi.fn() }));
vi.mock("postgres", () => ({ default: () => {
  const tx = Object.assign(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?");
    if (text.includes("AS ready")) return [{ ready: true }];
    if (text.includes("pg_roles")) return [{}, {}, {}];
    if (text.includes("AS tracked")) return [{ tracked: mock.applied, existing: mock.restored }];
    if (text.includes("SELECT checksum")) {
      if (!mock.applied) return [];
      const { readFileSync } = await import("node:fs");
      const { createHash } = await import("node:crypto");
      return [{ checksum: createHash("sha256").update(readFileSync(`drizzle/migrations/${values[0]}.sql`, "utf8")).digest("hex") }];
    }
    return [];
  }, { unsafe: async (source: string) => { mock.statements.push(source); } });
  return { begin: mock.begin.mockImplementation(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)), end: mock.close };
} }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); mock.statements = []; mock.applied = false; mock.restored = false; process.exitCode = 0; });
async function run() {
  vi.stubEnv("FIELD_OPS_STANDALONE", "1");
  vi.stubEnv("STANDALONE_DATABASE_URL", "postgresql://owner@127.0.0.1:5432/test");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // @ts-expect-error Directly executable deployment JavaScript.
  await import("../../deploy/migrate.mjs");
}
describe("standalone migration runner", () => {
  it("applies all thirteen checked-in migrations in order and grants device sequence access", async () => {
    await run();
    const sources = mock.statements.slice(1, -1);
    expect(sources).toHaveLength(13);
    expect(sources[0]).toContain("create type public.app_role");
    expect(sources[7]).toContain("ADD COLUMN router_logins_cipher");
    expect(sources[8]).toContain("ADD COLUMN IF NOT EXISTS site_id");
    expect(sources[9]).toContain("create table public.account_security");
    expect(sources[10]).toContain("create table public.invitation_history");
    expect(sources[11]).toContain("public.ensure_okta_access");
    expect(sources[12]).toContain("Okta reports your email address as not verified");
    expect(mock.statements.at(-1)).toContain("GRANT USAGE, SELECT ON SEQUENCE public.devices_id_seq TO authenticated");
  });
  it("skips already applied migrations without replaying table creation", async () => {
    mock.applied = true;
    await run();
    expect(mock.statements).toHaveLength(2);
    expect(mock.statements.join("\n")).not.toContain("create table public.profiles");
  });
  it("refuses a restored untracked application schema before creating anything", async () => {
    mock.restored = true;
    await run();
    expect(process.exitCode).toBe(1);
    expect(mock.statements).toEqual([]);
  });
});