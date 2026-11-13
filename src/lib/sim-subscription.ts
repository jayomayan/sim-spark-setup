import { checkConsoleRateLimit } from "@/lib/console-rate-limit";

export async function changeState(request: ConsoleRequest, imsi: string, state: "ACTIVE" | "PAUSE") {
  const res = await request("/sica/subscriptions/requests/state-changes", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ subscriptions: { identifier_type: "IMSI", identifiers: [imsi] }, change: { state } }),
  });
  checkConsoleRateLimit(res);
  if (!res.ok) throw new Error(`${state === "ACTIVE" ? "Activation" : "Pause"} failed (${res.status})`);
}

export type ConsoleRequest = (path: string, init?: RequestInit) => Promise<Response>;

/** Aeris Subscription Search: resolve an ICCID to its IMSI and current state. */
export async function findSubscription(request: ConsoleRequest, iccid: string) {
  // Aeris Subscription Search: identifierType must be "ICC" (ICCID), per the published spec.
  const res = await request("/subscriptions/details", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ identifierType: "ICC", identifierValues: [iccid] }),
  });
  checkConsoleRateLimit(res);
  if (!res.ok) throw new Error(`SIM lookup failed (${res.status})`);
  const j = (await res.json()) as { subscriptions?: { imsi?: string; state?: string; subscriptionState?: string; ips?: unknown }[] };
  const sub = j.subscriptions?.[0];
  if (!sub?.imsi) throw new Error("No SIM found in Console Connect for that ICCID");
  return { imsi: sub.imsi, state: sub.state ?? sub.subscriptionState, ips: sub.ips };
}
