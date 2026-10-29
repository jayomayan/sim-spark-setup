import { describe, expect, it, vi, afterEach } from "vitest";
import { CONSOLE_DEFAULTS, consoleSettingsSchema, providerUrlSchema } from "@/lib/console-connect";
import { memberConsoleConfig, readConsoleConfig } from "@/lib/console-connect.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { encryptPassword } from "@/lib/db-connection.server";

afterEach(() => vi.unstubAllEnvs());
describe("Console Connect configuration", () => {
  it("retains the current Console Connect Site ID endpoint configuration", () => {
    expect(CONSOLE_DEFAULTS.site_lookup).toEqual({ tokenUrl: "https://pccwg.iot.aeris.com/iot/api/auth/token", apiUrl: "https://iot-api.aeris.com/iot/api", clientId: "cm-public-api-client" });
  });
  it("rejects private hosts and credential-forwarding destinations", () => {
    for (const url of ["http://iot-api.aeris.com", "https://10.0.0.1", "https://aeris.com.attacker.example", "https://user:pass@iot-api.aeris.com", "https://iot-api.aeris.com?token=x"]) expect(providerUrlSchema.safeParse(url).success).toBe(false);
    expect(providerUrlSchema.safeParse("https://iot-api.aeris.com/iot/api").success).toBe(true);
  });
  it("requires the token endpoint for Site ID lookup", () => {
    expect(consoleSettingsSchema.safeParse({ integration: "site_lookup", apiUrl: CONSOLE_DEFAULTS.site_lookup.apiUrl, tokenUrl: "", clientId: "cm-public-api-client", username: "account" }).success).toBe(false);
  });
  it("rejects non-members before reading shared credentials", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: false, error: null }) } as unknown as SupabaseClient<Database>;
    await expect(memberConsoleConfig(client, "not-approved", "site_lookup")).rejects.toThrow("Approved access");
  });
  it("uses the existing server configuration when no settings have been saved", async () => {
    vi.stubEnv("AERIS_USERNAME", "test-account"); vi.stubEnv("AERIS_PASSWORD", "test-only-password");
    const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } as unknown as SupabaseClient<Database>;
    const config = await readConsoleConfig(client, "site_lookup");
    expect(config.apiUrl).toBe("https://iot-api.aeris.com/iot/api");
    expect(config.username).toBe("test-account");
    expect(config.password).toBe("test-only-password");
  });
  it("uses saved credentials instead of the previous server configuration", async () => {
    vi.stubEnv("DB_SECRET_KEY", "test-only-key");
    vi.stubEnv("AERIS_USERNAME", "old-account");
    const row = { token_url: CONSOLE_DEFAULTS.site_lookup.tokenUrl, api_url: "https://iot-api.aeris.com/iot/api/", client_id: "saved-client", username: "saved-account", password_cipher: encryptPassword("saved-test-password"), updated_at: "2026-10-29T00:00:00Z" };
    const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) } as unknown as SupabaseClient<Database>;
    const config = await readConsoleConfig(client, "site_lookup");
    expect(config.username).toBe("saved-account");
    expect(config.password).toBe("saved-test-password");
    expect(config.apiUrl).toBe("https://iot-api.aeris.com/iot/api");
  });
  it("SIM Activation uses the current Site ID Lookup credentials, never its previous account", async () => {
    vi.stubEnv("DB_SECRET_KEY", "test-only-key");
    vi.stubEnv("IOT_CC_USERNAME", "retired-sim-account");
    vi.stubEnv("IOT_CC_PASSWORD", "retired-sim-password");
    const rows = {
      site_lookup: { token_url: CONSOLE_DEFAULTS.site_lookup.tokenUrl, api_url: CONSOLE_DEFAULTS.site_lookup.apiUrl, client_id: "lookup-client", username: "current-lookup-account", password_cipher: encryptPassword("current-lookup-password"), updated_at: null },
      sim_activation: { token_url: "https://iot-api.aeris.com/old-token", api_url: "https://iot-api.aeris.com/sim-api", client_id: "old-sim-client", username: "old-sim-account", password_cipher: encryptPassword("old-sim-password"), updated_at: null },
    };
    const client = { from: () => ({ select: () => ({ eq: (_: string, integration: keyof typeof rows) => ({ maybeSingle: async () => ({ data: rows[integration], error: null }) }) }) }) } as unknown as SupabaseClient<Database>;
    const config = await readConsoleConfig(client, "sim_activation");
    expect(config.username).toBe("current-lookup-account");
    expect(config.password).toBe("current-lookup-password");
    expect(config.clientId).toBe("lookup-client");
    expect(config.tokenUrl).toBe(CONSOLE_DEFAULTS.site_lookup.tokenUrl);
    expect(config.apiUrl).toBe("https://iot-api.aeris.com/sim-api");
    rows.site_lookup.password_cipher = encryptPassword("updated-lookup-password");
    expect((await readConsoleConfig(client, "sim_activation")).password).toBe("updated-lookup-password");
  });
  it("SIM Activation shares Site ID Lookup's existing environment credentials before settings are saved", async () => {
    vi.stubEnv("AERIS_USERNAME", "lookup-env-account"); vi.stubEnv("AERIS_PASSWORD", "lookup-env-password");
    vi.stubEnv("IOT_CC_USERNAME", "different-sim-account"); vi.stubEnv("IOT_CC_PASSWORD", "different-sim-password");
    vi.stubEnv("IOT_CC_BASE_URL", "https://iot-api.aeris.com/sim-api");
    const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } as unknown as SupabaseClient<Database>;
    const config = await readConsoleConfig(client, "sim_activation");
    expect(config.username).toBe("lookup-env-account");
    expect(config.password).toBe("lookup-env-password");
    expect(config.apiUrl).toBe("https://iot-api.aeris.com/sim-api");
  });
});