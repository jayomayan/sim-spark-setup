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
  const username = data?.username ?? process.env["AERIS_USERNAME"] ?? "";
  const password = data ? (data.password_cipher ? decryptPassword(data.password_cipher) : "") : process.env["AERIS_PASSWORD"] ?? "";
  return {
    integration, tokenUrl: data?.token_url ?? defaults.tokenUrl,
    apiUrl: (data?.api_url ?? defaults.apiUrl).replace(/\/+$/, ""),
    clientId: data?.client_id ?? defaults.clientId, username, password,
    source: data ? "Saved in Admin Settings" : "Existing server configuration",
    credentialSource: "Site ID Lookup",
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
  let response: Response;
  try {
    response = await fetch(config.tokenUrl, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { Accept: "application/vnd.dcp-v1+json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: config.clientId, username: config.username, password: config.password }),
    });
  } catch {
    throw new Error("The website couldn't reach the Console Connect sign-in address. Check the address and whether Console Connect allows connections from the hosted website.");
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("Console Connect rejected sign-in (HTTP 401). Check the saved username, password and client ID.");
    if (response.status === 403) throw new Error("Console Connect denied access (HTTP 403). The account or hosted website may need permission from Console Connect.");
    if (response.status === 429) throw new Error("Console Connect is limiting sign-in requests (HTTP 429). Wait a few minutes and try again.");
    throw new Error(`Console Connect sign-in failed (HTTP ${response.status}). Check the sign-in address or contact your Console Connect administrator.`);
  }
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