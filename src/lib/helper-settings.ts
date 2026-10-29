import { z } from "zod";

// Shared between the Admin Settings form and the server functions that store the values.
// Each rule is exactly what the UR35 expects, plus a human description.
export const firewallRuleSchema = z.object({
  rule: z.string().trim().min(1, "Firewall rule is required").max(240),
  description: z.string().trim().max(240).default(""),
});
export type FirewallRule = z.infer<typeof firewallRuleSchema>;

export const routerLoginSchema = z.object({
  id: z.string().uuid(),
  username: z.string().trim().min(1, "Router username is required").max(80),
  password: z.string().max(200).default(""),
});
export type RouterLogin = z.infer<typeof routerLoginSchema>;

export type NtpSettings = { enabled: boolean; servers: string[]; timezone: string };

export const DEFAULT_FIREWALL_RULES: FirewallRule[] = [
  { rule: "allow tcp/443", description: "Allow HTTPS management" },
  { rule: "allow tcp/22", description: "Allow SSH management" },
  { rule: "drop tcp/80", description: "Drop WAN HTTP" },
  { rule: "drop any/0", description: "Drop all other inbound" },
];

export const DEFAULT_NTP_SETTINGS: NtpSettings = {
  enabled: true,
  servers: ["pool.ntp.org", "time.google.com"],
  timezone: "Asia/Manila",
};

const apiPathSchema = z
  .string()
  .trim()
  .regex(/^\//, "Path must start with /")
  .max(120);

export const helperSettingsInput = z.object({
  routerLogins: z.array(routerLoginSchema).max(50).default([]).refine(
    (logins) => new Set(logins.map((login) => login.id)).size === logins.length,
    "Router login IDs must be unique",
  ),
  ur35FirewallPath: apiPathSchema.default("/api/firewall/rules"),
  ur35NtpPath: apiPathSchema.default("/api/system/ntp"),
  firewallRules: z.array(firewallRuleSchema).max(50, "At most 50 firewall rules"),
  ntpEnabled: z.boolean().default(true),
  ntpServers: z.string().trim().max(400).default("pool.ntp.org, time.google.com"),
  ntpTimezone: z
    .string()
    .trim()
    .regex(/^[A-Za-z_]+(\/[A-Za-z_+]+)?$/, "Use a timezone like Asia/Manila")
    .default("Asia/Manila"),
});
export type HelperSettingsInput = z.input<typeof helperSettingsInput>;

/** Turns "pool.ntp.org, time.google.com" into a clean, de-duplicated server list. */
export function parseNtpServers(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const host = part
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
    if (host && /^[a-z0-9._:-]+$/.test(host)) seen.add(host);
  }
  return [...seen].slice(0, 8);
}

/** The one-line command an admin pastes on the helper machine. */
export function buildInstallCommand(origin: string, code: string): string {
  return `curl -fsSL ${origin}/helper/install.sh | sudo bash -s -- --console ${origin} --code ${code}`;
}

/** Short expiry keeps a leaked install command useless after a few minutes. */
export const ENROLLMENT_TTL_MINUTES = 30;
