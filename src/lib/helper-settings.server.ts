import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { decryptPassword, encryptPassword } from "@/lib/db-connection.server";
import {
  DEFAULT_FIREWALL_RULES,
  ENROLLMENT_TTL_MINUTES,
  parseRouterCommands,
  safeRouterCommands,
  type FirewallRule,
  type MiscSettings,
  type RouterLogin,
  type HelperSettingsInput,
} from "@/lib/helper-settings";

type Client = SupabaseClient<Database>;

export type HelperConfig = {
  configVersion: number;
  ur35Username: string;
  ur35Password: string;
  routerLogins: RouterLogin[];
  ur35FirewallPath: string;
  firewallRules: FirewallRule[];
  misc: MiscSettings;
};

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The helper's own key. Created once, stored encrypted, never shown in the app. */
export async function helperAgentToken(db: Client): Promise<string> {
  const row = await ensureRow(db);
  if (row.agent_token_cipher) return decryptPassword(row.agent_token_cipher);
  const token = randomBytes(32).toString("base64url");
  const { error } = await db
    .from("helper_settings")
    .update({ agent_token_cipher: encryptPassword(token), updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error("Couldn't save the helper key.");
  return token;
}

export async function matchesHelperToken(db: Client, candidate: string): Promise<boolean> {
  if (!candidate) return false;
  try {
    return safeEqual(candidate, await helperAgentToken(db));
  } catch {
    return false;
  }
}

/** Read without creating, so the cheap poll path stays cheap. */
export async function helperConfigVersion(db: Client): Promise<number> {
  const { data } = await db.from("helper_settings").select("config_version").eq("id", 1).maybeSingle();
  return data?.config_version ?? 0;
}

async function ensureRow(db: Client) {
  const { data, error } = await db.from("helper_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error("Couldn't load helper settings.");
  if (data) return data;
  const { data: created, error: insertError } = await db
    .from("helper_settings")
    .insert({ id: 1 })
    .select("*")
    .single();
  if (insertError || !created) throw new Error("Couldn't create helper settings.");
  return created;
}

/** Everything the helper needs to do router work, decrypted for on-machine use only. */
export async function helperConfig(db: Client): Promise<HelperConfig> {
  const row = await ensureRow(db);
  const routerLogins = readRouterLogins(row);
  // Rules saved before the two-field format are converted on read:
  // "Allow HTTPS mgmt / accept tcp 443" became "accept tcp/443" with that name as its description.
  const stored = Array.isArray(row.firewall_rules) ? (row.firewall_rules as Record<string, unknown>[]) : [];
  const rules: FirewallRule[] = stored
    .map((r) => {
      if (typeof r?.["rule"] === "string") {
        return { rule: r["rule"], description: typeof r["description"] === "string" ? r["description"] : "" };
      }
      if (typeof r?.["action"] === "string" && typeof r?.["protocol"] === "string" && typeof r?.["port"] === "number") {
        return {
          rule: `${r["action"]} ${r["protocol"]}/${r["port"]}`,
          description: typeof r["name"] === "string" ? r["name"] : "",
        };
      }
      return null;
    })
    .filter((r): r is FirewallRule => r !== null && r.rule.length > 0);
  const ntp = (row.ntp_settings ?? {}) as Partial<NtpSettings>;
  const ntp = (row.ntp_settings ?? {}) as Partial<NtpSettings>;
  return {
    configVersion: row.config_version,
    ur35Username: routerLogins[0]?.username ?? "",
    ur35Password: routerLogins[0]?.password ?? "",
    routerLogins,
    ur35FirewallPath: row.ur35_firewall_path || "/api/firewall/rules",
    ur35NtpPath: row.ur35_ntp_path || "/api/system/ntp",
    firewallRules: rules.length ? rules : DEFAULT_FIREWALL_RULES,
    ntp: {
      enabled: ntp.enabled ?? DEFAULT_NTP_SETTINGS.enabled,
      servers: ntp.servers?.length ? ntp.servers : DEFAULT_NTP_SETTINGS.servers,
      timezone: ntp.timezone || DEFAULT_NTP_SETTINGS.timezone,
    },
  };
}

const LEGACY_LOGIN_ID = "00000000-0000-4000-8000-000000000001";

function readRouterLogins(row: Database["public"]["Tables"]["helper_settings"]["Row"]): RouterLogin[] {
  if (row.router_logins_cipher !== null) return JSON.parse(decryptPassword(row.router_logins_cipher)) as RouterLogin[];
  return row.ur35_username ? [{
    id: LEGACY_LOGIN_ID,
    username: row.ur35_username,
    password: row.ur35_password_cipher ? decryptPassword(row.ur35_password_cipher) : "",
  }] : [];
}

export async function saveHelperConfig(db: Client, input: HelperSettingsInput) {
  const row = await ensureRow(db);
  const saved = readRouterLogins(row);
  const routerLogins = (input.routerLogins ?? []).map((login) => {
    const password = login.password || saved.find((stored) => stored.id === login.id)?.password || "";
    if (!password) throw new Error("Set a password for each new router login.");
    return { ...login, password };
  });
  const ntp: NtpSettings = {
    enabled: input.ntpEnabled ?? DEFAULT_NTP_SETTINGS.enabled,
    servers: parseNtpServers(input.ntpServers ?? DEFAULT_NTP_SETTINGS.servers.join(", ")),
    timezone: input.ntpTimezone ?? DEFAULT_NTP_SETTINGS.timezone,
  };
  if (input.ntpEnabled && ntp.servers.length === 0) throw new Error("Add at least one time server, or turn NTP off.");
  const { error } = await db
    .from("helper_settings")
    .update({
      router_logins_cipher: encryptPassword(JSON.stringify(routerLogins)),
      ur35_username: routerLogins[0]?.username ?? "",
      ur35_password_cipher: routerLogins[0]?.password ? encryptPassword(routerLogins[0].password) : null,
      ur35_firewall_path: input.ur35FirewallPath ?? "/api/firewall/rules",
      ur35_ntp_path: input.ur35NtpPath ?? "/api/system/ntp",
      firewall_rules: input.firewallRules as never,
      ntp_settings: ntp as never,
      config_version: row.config_version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error("Couldn't save helper settings.");
  return { configVersion: row.config_version + 1 };
}

/** One-time install code: the only secret a fresh machine ever needs. */
export async function createEnrollment(db: Client, userId: string) {
  const code = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MINUTES * 60_000).toISOString();
  await db.from("helper_enrollments").delete().lt("expires_at", new Date().toISOString());
  const { error } = await db
    .from("helper_enrollments")
    .insert({ code_hash: createHash("sha256").update(code).digest("hex"), created_by: userId, expires_at: expiresAt });
  if (error) throw new Error("Couldn't create the install code.");
  return { code, expiresAt };
}

/** Redeems a code once and hands back the helper key. Returns null when it isn't valid. */
export async function redeemEnrollment(db: Client, code: string): Promise<string | null> {
  if (typeof code !== "string" || code.length < 16 || code.length > 200) return null;
  const hash = createHash("sha256").update(code).digest("hex");
  const { data: row } = await db
    .from("helper_enrollments")
    .select("id,used_at,expires_at")
    .eq("code_hash", hash)
    .maybeSingle();
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  const { data: claimed } = await db
    .from("helper_enrollments")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return null;
  return helperAgentToken(db);
}
