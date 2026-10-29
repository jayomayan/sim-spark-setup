import { describe, expect, it, vi, afterEach } from "vitest";
import { CONSOLE_DEFAULTS, consoleSettingsSchema, providerUrlSchema } from "@/lib/console-connect";
import { memberConsoleConfig, readConsoleConfig } from "@/lib/console-connect.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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
});