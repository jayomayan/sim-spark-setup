import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { CONSOLE_DEFAULTS, type ConsoleIntegration } from "@/lib/console-connect";
import { decryptPassword } from "@/lib/db-connection.server";

export async function readConsoleConfig(client: SupabaseClient<Database>, integration: ConsoleIntegration): Promise<{
  integration: ConsoleIntegration; tokenUrl: string; apiUrl: string; clientId: string;
  username: string; password: string; source: string; credentialSource: string; updatedAt: string | null;
}> {
  if (integration === "sim_activation") {
    const shared = await readConsoleConfig(client, "site_lookup");
    return { ...shared, integration, credentialSource: "Shared with Site ID Lookup" };
  }
  const { data, error } = await client.from("console_connect_settings").select("*").eq("integration", integration).maybeSingle();
  if (error) throw new Error("Couldn't load Console Connect settings.");
  const defaults = CONSOLE_DEFAULTS[integration];
  const lookup = integration === "site_lookup";
  const shared = lookup ? null : await readConsoleConfig(client, "site_lookup");
  const username = shared?.username ?? data?.username ?? process.env["AERIS_USERNAME"] ?? "";
  const password = shared?.password ?? (data ? (data.password_cipher ? decryptPassword(data.password_cipher) : "") : process.env["AERIS_PASSWORD"] ?? "");
  return {
    integration, tokenUrl: shared?.tokenUrl ?? data?.token_url ?? defaults.tokenUrl,
    apiUrl: (data?.api_url ?? (lookup ? defaults.apiUrl : process.env["IOT_CC_BASE_URL"] ?? "")).replace(/\/+$/, ""),
    clientId: shared?.clientId ?? data?.client_id ?? defaults.clientId, username, password,
    source: data ? "Saved in Admin Settings" : "Existing server configuration",
    credentialSource: lookup ? "Site ID Lookup" : "Shared with Site ID Lookup",
    updatedAt: data?.updated_at ?? null,
  };
}

export async function memberConsoleConfig(client: SupabaseClient<Database>, userId: string, integration: ConsoleIntegration) {
  const { data, error } = await client.rpc("is_member", { _user_id: userId });
  if (error || data !== true) throw new Error("Approved access is required.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return readConsoleConfig(supabaseAdmin, integration);
}

export async function consoleToken(config: Awaited<ReturnType<typeof readConsoleConfig>>) {
  const response = await fetch(config.tokenUrl, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { Accept: "application/vnd.dcp-v1+json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: config.clientId, username: config.username, password: config.password }),
  });
  if (!response.ok) throw new Error("Console Connect rejected the sign-in. Check the account details.");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Console Connect did not return a sign-in token.");
  return body.access_token;
}

export async function consoleApiRequest(config: Awaited<ReturnType<typeof readConsoleConfig>>, path: string, init: RequestInit = {}) {
  const token = await consoleToken(config);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  return fetch(`${config.apiUrl}${path}`, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(10000) });
}