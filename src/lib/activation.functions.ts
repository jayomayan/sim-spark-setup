import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const validIccid = (s: string) => /^\d{18,22}$/.test(s);

export const activateSim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { iccid: string }) => {
    if (!validIccid(d.iccid)) throw new Error("ICCID must be 18–22 digits");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { memberConsoleConfig, consoleApiRequest } = await import("@/lib/console-connect.server");
    const config = await memberConsoleConfig(context.supabase, context.userId, "sim_activation");
    const cfg = config.apiUrl && config.username && config.password;
    if (!cfg) {
      await wait(1200);
      return { ok: true, simulated: true };
    }
    const res = await consoleApiRequest(config, `/devices/${data.iccid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVATED" }),
    });
    if (!res.ok) throw new Error(`Activation failed (${res.status})`);
    return { ok: true, simulated: false };
  });

export const getSimIp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { iccid: string; attempt: number }) => d)
  .handler(async ({ data, context }) => {
    const { memberConsoleConfig, consoleApiRequest } = await import("@/lib/console-connect.server");
    const config = await memberConsoleConfig(context.supabase, context.userId, "sim_activation");
    const cfg = config.apiUrl && config.username && config.password;
    if (!cfg) {
      await wait(800);
      if (data.attempt < 3) return { ip: null as string | null, status: "PENDING", simulated: true };
      const n = Number(data.iccid.slice(-4)) || 1;
      return { ip: `10.${(n >> 8) % 255}.${n % 255}.${((data.attempt * 7) % 250) + 2}`, status: "ACTIVE", simulated: true };
    }
    const res = await consoleApiRequest(config, `/devices/${data.iccid}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Status lookup failed (${res.status})`);
    const j = (await res.json()) as { status?: string; fixedIPAddress?: string; ipAddress?: string };
    return { ip: j.fixedIPAddress || j.ipAddress || null, status: j.status ?? "UNKNOWN", simulated: false };
  });
