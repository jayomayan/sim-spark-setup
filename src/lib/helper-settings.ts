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
  username: z.string().trim().min(1, "Router username is required").max(80).regex(/^\S+$/, "Router username cannot contain spaces"),
  password: z.string().max(200).regex(/^[^\r\n]*$/, "Router password cannot contain line breaks").default(""),
});
export type RouterLogin = z.infer<typeof routerLoginSchema>;

export type MiscSettings = { enabled: boolean; commands: string[] };

export const DEFAULT_FIREWALL_RULES: FirewallRule[] = [
  { rule: "allow tcp/443", description: "Allow HTTPS management" },
  { rule: "allow tcp/22", description: "Allow SSH management" },
  { rule: "drop tcp/80", description: "Drop WAN HTTP" },
  { rule: "drop any/0", description: "Drop all other inbound" },
];

const apiPathSchema = z
  .string()
  .trim()
  .regex(/^\//, "Path must start with /")
  .max(120);

const MAX_MISC_COMMANDS = 50;
const MISC_COMMAND_TOO_LONG = 255;
const MISC_SHELL_CHARS = /[;&|<>$`]/;

/** One router command per line; blank lines are ignored. */
export function parseRouterCommands(text: string): string[] {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > MAX_MISC_COMMANDS) throw new Error("Use at most 50 miscellaneous commands, one per line.");
  if (lines.some((line) => line.length > MISC_COMMAND_TOO_LONG)) throw new Error(`Each miscellaneous command must be ${MISC_COMMAND_TOO_LONG} characters or fewer.`);
  if (lines.some((line) => MISC_SHELL_CHARS.test(line))) throw new Error("Miscellaneous commands can't contain shell characters like ; & | < > $ or `.");
  return lines;
}

/** Same rules, but used when reading saved settings: unusable lines are dropped, never applied. */
export function safeRouterCommands(text: string): string[] {
  return String(text ?? "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= MISC_COMMAND_TOO_LONG && !MISC_SHELL_CHARS.test(line))
    .slice(0, MAX_MISC_COMMANDS);
}

export const helperSettingsInput = z.object({
  routerLogins: z.array(routerLoginSchema).max(50).default([]).refine(
    (logins) => new Set(logins.map((login) => login.id)).size === logins.length,
    "Router login IDs must be unique",
  ),
  ur35FirewallPath: apiPathSchema.default("/api/firewall/rules"),
  firewallRules: z.array(firewallRuleSchema).max(50, "At most 50 firewall rules"),
  miscEnabled: z.boolean().default(false),
  miscCommands: z.string().max(20_000).default(""),
});
export type HelperSettingsInput = z.input<typeof helperSettingsInput>;

/** The one-line command an admin pastes on the helper machine. */
export function buildInstallCommand(origin: string, code: string): string {
  return `curl -fsSL ${origin}/helper/install.sh | sudo bash -s -- --console ${origin} --code ${code}`;
}

/** Short expiry keeps a leaked install command useless after a few minutes. */
export const ENROLLMENT_TTL_MINUTES = 30;
