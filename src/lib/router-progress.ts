import { z } from "zod";

export const routerProgressEvent = z.object({
  stage: z.enum(["connecting", "connected", "authenticating", "authenticated", "login_rejected", "retrying", "cli", "privileged", "reading", "checking", "configuring", "rule", "rule_applied", "unchanged", "saving", "saved", "verifying", "verified", "closed"]),
  index: z.number().int().min(1).max(50).optional(),
  total: z.number().int().min(1).max(50).optional(),
});
export const routerProgressSchema = z.object({ progress: z.array(routerProgressEvent).max(100) });
export type RouterProgressEvent = z.infer<typeof routerProgressEvent>;

export function routerProgressLabel(event: RouterProgressEvent): string {
  const labels: Record<RouterProgressEvent["stage"], string> = {
    connecting: "Connecting to router on SSH port 22…",
    connected: "Connected to router; negotiating secure connection…",
    authenticating: "Entering saved credentials securely…",
    authenticated: "Router login successful",
    login_rejected: "Login rejected; checking the next saved login…",
    retrying: "Router not reachable yet; retrying in 10 seconds…",
    cli: "Opening router command session…",
    privileged: "Checking configuration permissions…",
    reading: "Reading current router settings…",
    checking: "Checking existing firewall rules for conflicts…",
    configuring: "Entering configuration mode…",
    rule: `Applying firewall rule ${event.index ?? ""} of ${event.total ?? ""}…`,
    rule_applied: `Firewall rule ${event.index ?? ""} of ${event.total ?? ""} accepted`,
    unchanged: "All requested rules are already present; no changes needed",
    saving: "Saving router configuration…",
    saved: "Router configuration saved",
    verifying: "Reading back and verifying firewall rules…",
    verified: "All firewall rules verified",
    closed: "Router connection closed",
  };
  return labels[event.stage];
}