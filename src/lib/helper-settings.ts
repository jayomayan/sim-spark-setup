import { z } from "zod";

// Shared between the Admin Settings form and the server functions that store the values.
export const FIREWALL_ACTIONS = ["accept", "drop"] as const;
export const FIREWALL_PROTOCOLS = ["tcp", "udp", "any"] as const;

export const firewallRuleSchema = z.object({
  name: z.string().trim().min(1, "Rule name is required").max(60),
  action: z.enum(FIREWALL_ACTIONS),
  protocol: z.enum(FIREWALL_PROTOCOLS),
  port: z.coerce.number().int().min(0).max(65535),
});
export type FirewallRule = z.infer<typeof firewallRuleSchema>;

export type NtpSettings = { enabled: boolean; servers: string[]; timezone: string };

export const DEFAULT_FIREWALL_RULES: FirewallRule[] = [
  { name: "Allow HTTPS mgmt", action: "accept", protocol: "tcp", port: 443 },
  { name: "Allow SSH mgmt", action: "accept", protocol: "tcp", port: 22 },
  { name: "Drop WAN HTTP", action: "drop", protocol: "tcp", port: 80 },
  { name: "Drop all other inbound", action: "drop", protocol: "any", port: 0 },
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
  ur35Username: z.string().trim().max(80).default(""),
  ur35Password: z.string().max(200).optional(),
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
