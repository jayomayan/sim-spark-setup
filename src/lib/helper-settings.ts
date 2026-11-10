import { z } from "zod";

export type FirewallRule = { rule: string; description: string };
export type RouterLogin = { id: string; username: string; password: string };
export type MiscSettings = { enabled: boolean; commands: string[] };

export const DEFAULT_FIREWALL_RULES: FirewallRule[] = [
  { rule: "allow tcp/443", description: "Allow HTTPS management" },
  { rule: "allow tcp/22", description: "Allow SSH management" },
  { rule: "drop tcp/80", description: "Drop WAN HTTP" },
  { rule: "drop any/0", description: "Drop all other inbound" },
];

export const DEFAULT_MISC_SETTINGS: MiscSettings = { enabled: false, commands: [] };

export const ENROLLMENT_TTL_MINUTES = 60;
export const MAX_ROUTER_LOGINS = 50;

const apiPathSchema = z.string().trim().regex(/^\/[A-Za-z0-9._/-]*$/, "Use a path such as /api/firewall/rules");
const COMMAND_TOO_LONG = 255;
const COMMAND_SHELL_CHARS = /[;&|<>$`]/;

/** One router command per line; blank lines are ignored. */
export function parseRouterCommands(text: string): string[] {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > MAX_ROUTER_LOGINS) throw new Error("Use at most 50 miscellaneous commands, one per line.");
  if (lines.some((line) => line.length > COMMAND_TOO_LONG)) throw new Error(`Each miscellaneous command must be ${COMMAND_TOO_LONG} characters or fewer.`);
  if (lines.some((line) => COMMAND_SHELL_CHARS.test(line))) throw new Error("Miscellaneous commands can't contain shell characters like ; & | < > $ or `.");
  return lines;
}

/** Same rules, but used when reading saved settings: unusable lines are dropped, never applied. */
export function safeRouterCommands(text: string): string[] {
  return String(text ?? "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= COMMAND_TOO_LONG && !COMMAND_SHELL_CHARS.test(line))
    .slice(0, MAX_ROUTER_LOGINS);
}

export const firewallRuleSchema = z.object({
  rule: z.string().trim().min(1).max(255),
  description: z.string().trim().max(500).default(""),
});

export const helperSettingsInput = z.object({
  routerLogins: z.array(z.object({
    id: z.string().uuid(),
    username: z.string().trim().min(1).max(64),
    password: z.string().max(256).default(""),
  })).min(1, "Add at least one router login.").max(MAX_ROUTER_LOGINS),
  ur35FirewallPath: apiPathSchema.default("/api/firewall/rules"),
  firewallRules: z.array(firewallRuleSchema).min(1).max(50),
  miscEnabled: z.boolean().default(false),
  miscCommands: z.string().max(20_000).default(""),
});
export type HelperSettingsInput = z.infer<typeof helperSettingsInput>;

export function buildInstallCommand(urlBase: string, code: string) {
  const base = urlBase.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) throw new Error("Use the console's HTTPS address.");
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(code)) throw new Error("Install code is not valid.");
  return `curl -fsSL ${base}/helper/install.sh | sudo -E env CONSOLE_URL=${base} ENROLLMENT_CODE=${code} bash`;
}
