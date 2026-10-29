import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Look up a site's current router IP through Aeris (IoT Console Connect). */
export const lookupSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { siteId: string }) => {
    if (!/^PH[A-Z0-9-]{1,30}$/i.test(d.siteId)) throw new Error("Site ID should look like PH010010");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { memberConsoleConfig, consoleToken } = await import("@/lib/console-connect.server");
    const config = await memberConsoleConfig(context.supabase, context.userId, "site_lookup");
    if (!config.username || !config.password) return { error: "Console Connect login isn't set up yet. Ask an admin to configure it in Admin Settings.", ip: null, network: null };
    try {
    const token = await consoleToken(config);
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };

    const sub = await fetch(
      `${config.apiUrl}/subscriptions/details?q=label==${encodeURIComponent(data.siteId)}`,
      { headers: h, redirect: "error", signal: AbortSignal.timeout(10000) },
    );
    if (!sub.ok) return { error: "Aeris site search failed.", ip: null, network: null };
    const s = (await sub.json()) as { size?: number; subscriptions?: { imsi: string }[] };
    const imsi = s.subscriptions?.[0]?.imsi;
    if (!imsi || s.size === 0) return { error: "No subscription found for that Site ID.", ip: null, network: null };

    const ev = await fetch(`${config.apiUrl}/xdr/events?imsi=${encodeURIComponent(imsi)}`, { headers: h, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!ev.ok) return { error: "Couldn't load events for that Site ID.", ip: null, network: null };
    const items = ((await ev.json()) as { items?: { id: string; occurred_at: string }[] }).items ?? [];
    const latest = [...items].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))[0];
    if (!latest) return { error: "No events found for that Site ID.", ip: null, network: null };

    const det = await fetch(`${config.apiUrl}/xdr/events/${encodeURIComponent(latest.id)}`, { headers: h, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!det.ok) return { error: "Couldn't load the latest event.", ip: null, network: null };
    const d = (await det.json()) as { terminal_ip?: string; visited_nw?: string };
    if (!d.terminal_ip) return { error: "No router IP found for that Site ID.", ip: null, network: null };
    return { error: null, ip: d.terminal_ip, network: d.visited_nw ?? null };
    } catch { return { error: "Couldn't connect to Console Connect. Ask an admin to test the saved connection.", ip: null, network: null }; }
  });
