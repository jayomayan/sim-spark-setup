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
  const startedAt = Date.now();
  try {
    response = await fetch(config.tokenUrl, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { Accept: "application/vnd.dcp-v1+json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: config.clientId, username: config.username, password: config.password }),
    });
  } catch (error) {
    // Never log the exception or request: either can contain credentials.
    const reference = crypto.randomUUID();
    const detail = error instanceof Error ? `${error.name} ${error.message}` : "";
    const cause = error instanceof Error ? error.cause : undefined;
    const causeCode = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
    let category = "connection";
    let message = "The live server could not establish a connection to Console Connect. Your saved credentials have not been rejected.";
    if (/timeout|timed out|abort/i.test(detail) || causeCode === "ETIMEDOUT") {
      category = "timeout";
      message = "Console Connect did not respond within 10 seconds. Try again; if this continues, ask Console Connect to check connections from the live website.";
    } else if (/redirect/i.test(detail)) {
      category = "redirect";
      message = "Console Connect redirected the sign-in request. Use its direct HTTPS token address; credentials were not forwarded to the redirected address.";
    } else if (/certificate|tls|ssl/i.test(detail + causeCode)) {
      category = "tls";
      message = "The live server could not verify Console Connect's secure connection. Console Connect needs to check the certificate chain for its token address.";
    } else if (/dns|resolve|enotfound|eai_again/i.test(detail + causeCode)) {
      category = "dns";
      message = "The live server could not resolve Console Connect's sign-in address. Check the token address and its public DNS configuration.";
    }
    console.error("Console Connect transport failure", { reference, category, elapsedMs: Date.now() - startedAt });
    throw new Error(`${message} Diagnostic reference: ${reference}.`);
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