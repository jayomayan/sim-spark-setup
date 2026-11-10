import { checkConsoleRateLimit } from "@/lib/console-rate-limit";

/** Assigned addresses describe allocation, not device reachability. */
export type AssignedIp = { ip?: unknown; ipVersion?: string; ip_version?: string };
type Event = { id?: string; occurred_at?: string; terminal_ip?: string; visited_nw?: string };
type Request = (path: string) => Promise<Response>;

function validIp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  return value !== "0.0.0.0" && value !== "255.255.255.255" && value.split(".").every((part) => Number(part) <= 255);
}

function assignedIp(entries: unknown) {
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as AssignedIp;
    if (value.ipVersion === "IPV6" || value.ip_version === "IPV6") continue;
    if (validIp(value.ip)) return value.ip;
  }
  return null;
}

/** Reuse the details already fetched for ICCID/Site ID; inventory and XDR are fallbacks. */
export async function findSimIp(request: Request, imsi: string, ips?: unknown) {
  const direct = assignedIp(ips);
  if (direct) return { ip: direct, network: null };
  const response = await request(`/sica/subscriptions/sim-resource/${encodeURIComponent(imsi)}?identifier_type=IMSI`);
  checkConsoleRateLimit(response);
  // Older accounts may not expose inventory. Do not hide auth, throttling or server errors.
  if (response.status !== 404 && response.status !== 405) {
    if (!response.ok) throw new Error(`Console Connect fixed IP lookup failed (HTTP ${response.status}). Try the IP address check again.`);
    const body = await response.json() as { sims?: { fixed_ips?: unknown }[] };
    for (const sim of body.sims ?? []) {
      const fixed = assignedIp(sim.fixed_ips);
      if (fixed) return { ip: fixed, network: null };
    }
  }
  return findEventIp(request, imsi);
}

/** Ask the provider for newest-first before paging, not just sorting its oldest page. */
export async function findEventIp(request: Request, imsi: string) {
  const response = await request(`/xdr/events?imsi=${encodeURIComponent(imsi)}&sort=occurred_at:desc&limit=10&additionalFields=terminal_ip,visited_nw`);
  checkConsoleRateLimit(response);
  if (!response.ok) throw new Error(`Console Connect IP event lookup failed (HTTP ${response.status}). Try the IP address check again.`);
  const body = await response.json() as { items?: Event[] };
  const items = [...(body.items ?? [])].sort((a, b) =>
    (Date.parse(b.occurred_at ?? "") || 0) - (Date.parse(a.occurred_at ?? "") || 0));
  // Prefer a list-provided IP before spending calls on event details.
  const direct = items.slice(0, 10).find((event) => validIp(event.terminal_ip));
  if (direct) return { ip: direct.terminal_ip ?? null, network: direct.visited_nw ?? null };
  // Bound provider calls while checking past newer registration/SMS events without IPs.
  for (const event of items.slice(0, 10)) {
    if (validIp(event.terminal_ip)) return { ip: event.terminal_ip, network: event.visited_nw ?? null };
    if (!event.id) continue;
    const detail = await request(`/xdr/events/${encodeURIComponent(event.id)}`);
    checkConsoleRateLimit(detail);
    if (detail.status === 404) continue;
    if (!detail.ok) throw new Error(`Console Connect IP event details failed (HTTP ${detail.status}). Try the IP address check again.`);
    const data = await detail.json() as Event;
    if (validIp(data.terminal_ip)) return { ip: data.terminal_ip, network: data.visited_nw ?? null };
  }
  return { ip: null, network: null };
}