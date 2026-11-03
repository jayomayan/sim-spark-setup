import { describe, expect, it, vi, afterEach } from "vitest";
import { CONSOLE_DEFAULTS, consoleSettingsSchema, providerUrlSchema } from "@/lib/console-connect";
import { consoleApiRequest, consoleToken, memberConsoleConfig, readConsoleConfig } from "@/lib/console-connect.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { encryptPassword } from "@/lib/db-connection.server";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("Console Connect configuration", () => {
  it.each([
    [new DOMException("Timed out", "TimeoutError"), "timeout"],
    [new TypeError("Redirect encountered"), "redirect"],
    [new TypeError("TLS certificate failed"), "tls"],
    [new TypeError("DNS resolution failed"), "dns"],
    [new TypeError("private-password private-provider-response"), "connection"],
  ])("classifies transport errors without exposing request secrets: %s", async (failure, category) => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
    const config = { integration: "site_lookup" as const, ...CONSOLE_DEFAULTS.site_lookup, username: "test-user", password: "private-password", source: "test", credentialSource: "test", updatedAt: null };
    const error = await consoleToken(config).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Diagnostic reference:");
    expect(logger).toHaveBeenCalledWith("Console Connect transport failure", expect.objectContaining({ category }));
    for (const secret of [config.password, "private-provider-response", config.username]) {
      expect((error as Error).message).not.toContain(secret);
      expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
    }
  });
  it.each([401, 403, 429, 500])("reports the provider HTTP %s without exposing its response or credentials", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-provider-response", { status })));
    const config = { integration: "site_lookup" as const, ...CONSOLE_DEFAULTS.site_lookup, username: "test-user", password: "private-password", source: "test", credentialSource: "test", updatedAt: null };
    const error = await consoleToken(config).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(`HTTP ${status}`);
    expect((error as Error).message).not.toContain("private-provider-response");
    expect((error as Error).message).not.toContain(config.password);
  });
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
    expect(config.apiUrl).toBe(CONSOLE_DEFAULTS.site_lookup.apiUrl);
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
    expect(config.apiUrl).toBe(CONSOLE_DEFAULTS.site_lookup.apiUrl);
  });
  it("rejects separate SIM Activation settings", () => {
    expect(consoleSettingsSchema.safeParse({ integration: "sim_activation", apiUrl: CONSOLE_DEFAULTS.site_lookup.apiUrl, tokenUrl: CONSOLE_DEFAULTS.site_lookup.tokenUrl, clientId: "client", username: "account" }).success).toBe(false);
  });
  it.each(["PUT", "GET"])("SIM %s requests use Site ID Lookup password grant and bearer authentication", async (method) => {
    vi.stubEnv("AERIS_USERNAME", "lookup-account"); vi.stubEnv("AERIS_PASSWORD", "lookup-password");
    const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } as unknown as SupabaseClient<Database>;
    const config = await readConsoleConfig(client, "sim_activation");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "test-token" }))).mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await consoleApiRequest(config, "/devices/123456789012345678", { method });
    const tokenCall = fetchMock.mock.calls[0];
    const apiCall = fetchMock.mock.calls[1];
    if (!tokenCall || !apiCall) throw new Error("Expected token and SIM API requests");
    expect(tokenCall[0]).toBe(CONSOLE_DEFAULTS.site_lookup.tokenUrl);
    const grant = tokenCall[1].body as URLSearchParams;
    expect(grant.get("grant_type")).toBe("password");
    expect(grant.get("username")).toBe("lookup-account");
    expect(grant.get("password")).toBe("lookup-password");
    expect(apiCall[0]).toBe(`${CONSOLE_DEFAULTS.site_lookup.apiUrl}/devices/123456789012345678`);
    expect(apiCall[1].headers.get("Authorization")).toBe("Bearer test-token");
  });
});