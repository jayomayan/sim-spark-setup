import { checkConsoleRateLimit } from "@/lib/console-rate-limit";

/** Shared XDR lookup: non-data events can be newer than the event containing the IP. */
type Event = { id?: string; occurred_at?: string; terminal_ip?: string; visited_nw?: string };
type Request = (path: string) => Promise<Response>;

function validIp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  return value !== "0.0.0.0" && value !== "255.255.255.255" && value.split(".").every((part) => Number(part) <= 255);
}

export async function findSimIp(request: Request, imsi: string) {
  const response = await request(`/xdr/events?imsi=${encodeURIComponent(imsi)}`);
  checkConsoleRateLimit(response);
  if (!response.ok) throw new Error(`Console Connect IP event lookup failed (HTTP ${response.status}). Try the IP address check again.`);
  const body = await response.json() as { items?: Event[] };
  const items = [...(body.items ?? [])].sort((a, b) =>
    (Date.parse(b.occurred_at ?? "") || 0) - (Date.parse(a.occurred_at ?? "") || 0));
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