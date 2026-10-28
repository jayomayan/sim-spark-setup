import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Look up a site's current router IP through Aeris (IoT Console Connect). */
export const lookupSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { siteId: string }) => {
    if (!/^PH[A-Z0-9-]{1,30}$/i.test(d.siteId)) throw new Error("Site ID should look like PH010010");
    return d;
  })
  .handler(async ({ data }) => {
    const username = process.env["AERIS_USERNAME"];
    const password = process.env["AERIS_PASSWORD"];
    if (!username || !password) return { error: "Aeris login isn't set up yet.", ip: null, network: null };

    const tokRes = await fetch("https://pccwg.iot.aeris.com/iot/api/auth/token", {
      method: "POST",
      headers: { Accept: "application/vnd.dcp-v1+json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password", client_id: "cm-public-api-client", username, password }),
    });
    if (!tokRes.ok) return { error: "Couldn't sign in to Aeris.", ip: null, network: null };
    const token = ((await tokRes.json()) as { access_token: string }).access_token;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };

    const sub = await fetch(
      `https://iot-api.aeris.com/iot/api/subscriptions/details?q=label==${encodeURIComponent(data.siteId)}`,
      { headers: h },
    );
    if (!sub.ok) return { error: "Aeris site search failed.", ip: null, network: null };
    const s = (await sub.json()) as { size?: number; subscriptions?: { imsi: string }[] };
    const imsi = s.subscriptions?.[0]?.imsi;
    if (!imsi || s.size === 0) return { error: "No subscription found for that Site ID.", ip: null, network: null };

    const ev = await fetch(`https://iot-api.aeris.com/iot/api/xdr/events?imsi=${encodeURIComponent(imsi)}`, { headers: h });
    if (!ev.ok) return { error: "Couldn't load events for that Site ID.", ip: null, network: null };
    const items = ((await ev.json()) as { items?: { id: string; occurred_at: string }[] }).items ?? [];
    const latest = [...items].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))[0];
    if (!latest) return { error: "No events found for that Site ID.", ip: null, network: null };

    const det = await fetch(`https://iot-api.aeris.com/iot/api/xdr/events/${encodeURIComponent(latest.id)}`, { headers: h });
    if (!det.ok) return { error: "Couldn't load the latest event.", ip: null, network: null };
    const d = (await det.json()) as { terminal_ip?: string; visited_nw?: string };
    if (!d.terminal_ip) return { error: "No router IP found for that Site ID.", ip: null, network: null };
    return { error: null, ip: d.terminal_ip, network: d.visited_nw ?? null };
  });
