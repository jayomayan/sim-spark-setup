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
    const { memberConsoleConfig, createConsoleRequest } = await import("@/lib/console-connect.server");
    const { findSimIp } = await import("@/lib/sim-ip.server");
    const config = await memberConsoleConfig(context.supabase, context.userId, "site_lookup");
    if (!config.username || !config.password) return { error: "Console Connect login isn't set up yet. Ask an admin to configure it in Admin Settings.", ip: null, network: null };
    try {
    const request = createConsoleRequest(config);

    const sub = await request(`/subscriptions/details?q=label==${encodeURIComponent(data.siteId)}`);
    if (!sub.ok) return { error: "Aeris site search failed.", ip: null, network: null };
    const s = (await sub.json()) as { size?: number; subscriptions?: { imsi: string; ips?: unknown }[] };
    const subscription = s.subscriptions?.[0];
    const imsi = subscription?.imsi;
    if (!imsi || s.size === 0) return { error: "No subscription found for that Site ID.", ip: null, network: null };

    const result = await findSimIp(request, imsi, subscription?.ips);
    if (!result.ip) return { error: "No router IP found for that Site ID.", ip: null, network: null };
    return { error: null, ...result };
    } catch { return { error: "Couldn't connect to Console Connect. Ask an admin to test the saved connection.", ip: null, network: null }; }
  });
