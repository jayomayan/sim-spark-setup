import { describe, expect, it } from "vitest";
// @ts-expect-error Deployment tooling is JavaScript for direct Node execution.
import { validateEnvironment } from "../../deploy/config.mjs";

const env = { VITE_SUPABASE_URL: "https://backend.example.com", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_URL: "http://127.0.0.1:8000", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test", DB_SECRET_KEY: "a".repeat(32) };
describe("standalone deployment isolation", () => {
  it("accepts a standalone public backend and private local server connection", () => {
    expect(validateEnvironment(env, { runtime: true })).toEqual([]);
  });
  it("rejects the current hosted backend for a standalone build", () => {
    expect(validateEnvironment({ ...env, VITE_SUPABASE_URL: "https://project.supabase.co" })).toContain("VITE_SUPABASE_URL still targets hosted infrastructure, not the standalone backend");
  });
  it("rejects an administrative key in browser configuration", () => {
    expect(validateEnvironment({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" })).toContain("The browser key cannot be an administrative key");
  });
  it("rejects server secrets with a browser-visible prefix", () => {
    expect(validateEnvironment({ ...env, VITE_DB_SECRET_KEY: "private" })).toContain("VITE_DB_SECRET_KEY cannot be exposed to the browser");
  });
  it("rejects mismatched browser and server public keys", () => {
    expect(validateEnvironment({ ...env, SUPABASE_PUBLISHABLE_KEY: "different" }, { runtime: true })).toContain("Browser and server public keys must match");
  });
});