import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { matchCustomFields } from "@/lib/sim-custom-fields";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const validIccid = (s: string) => /^\d{18,22}$/.test(s);

export const activateSim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { iccid: string; label?: string | undefined }) => {
    if (!validIccid(d.iccid)) throw new Error("ICCID must be 18–22 digits");
    if (d.label && (d.label.length > 64 || /[\r\n]/.test(d.label))) throw new Error("Site ID is too long");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { memberConsoleConfig, consoleApiRequest } = await import("@/lib/console-connect.server");
    const config = await memberConsoleConfig(context.supabase, context.userId, "sim_activation");
    const cfg = config.apiUrl && config.username && config.password;
    if (!cfg) {
      await wait(1200);
      return { ok: true, simulated: true, alreadyActive: false, labelWarning: null as string | null };
    }
    const sub = await findSubscription(consoleApiRequest, config, data.iccid);
    if (sub.state === "ACTIVE") {
      return { ok: true, simulated: false, alreadyActive: true, labelWarning: null as string | null };
    }
    {
      const res = await consoleApiRequest(config, "/sica/subscriptions/requests/state-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ subscriptions: { identifier_type: "IMSI", identifiers: [sub.imsi] }, change: { state: "ACTIVE" } }),
      });
      if (!res.ok) throw new Error(`Activation failed (${res.status})`);
    }
    // Best effort: write the existing "Label" custom field (e.g. the account uses "Label#")
    // with the Site ID via Aeris Subscription Custom Fields API. Never blocks activation.
    // Equipment (GPS-Battery / GPS-Genset) is not sent to Console Connect.
    let labelWarning: string | null = null;
    if (data.label) {
      try {
        // Resolve the exact existing custom field (e.g. the account uses "Label#").
        const list = await consoleApiRequest(config, "/subscriptions/custom-fields", { headers: { Accept: "application/json" } });
        if (!list.ok) throw new Error(`fields ${list.status}`);
        const items = ((await list.json()) as { items?: { id?: string | number; fieldName?: string }[] }).items ?? [];
        const { customFields, missing } = matchCustomFields(items, { label: data.label });
        const problems: string[] = [];
        if (missing.length) problems.push(`no "${missing.join('" or "')}" field exists in Console Connect`);
        if (customFields.length) {
          const r = await consoleApiRequest(config, "/subscriptions/custom-fields/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ identifierType: "IMSI", identifiers: [sub.imsi], customFields }),
          });
          if (!r.ok) {
            const detail = await r.json().then((b: unknown) => {
              const p = (Array.isArray(b) ? b[0] : b) as { detail?: unknown } | undefined;
              return typeof p?.detail === "string" ? p.detail.replace(/[^\w\s:#().,'"-]/g, "").slice(0, 120) : "";
            }).catch(() => "");
            problems.unshift(`${r.status}${detail ? `: ${detail}` : ""}`);
          }
        }
        if (problems.length) labelWarning = `Site ID label not updated in Console Connect (${problems.join("; ")})`;
      } catch {
        labelWarning = "Site ID label not updated in Console Connect (connection error)";
      }
    }
    return { ok: true, simulated: false, alreadyActive: false, labelWarning };
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
    const sub = await findSubscription(consoleApiRequest, config, data.iccid);
    if (sub.state !== "ACTIVE") return { ip: null as string | null, status: sub.state ?? "PENDING", simulated: false };
    const ev = await consoleApiRequest(config, `/xdr/events?imsi=${encodeURIComponent(sub.imsi)}`, { headers: { Accept: "application/json" } });
    if (!ev.ok) return { ip: null as string | null, status: "ACTIVE", simulated: false };
    const items = ((await ev.json()) as { items?: { id: string; occurred_at: string }[] }).items ?? [];
    const latest = [...items].sort((x, y) => (x.occurred_at < y.occurred_at ? 1 : -1))[0];
    if (!latest) return { ip: null as string | null, status: "ACTIVE", simulated: false };
    const det = await consoleApiRequest(config, `/xdr/events/${encodeURIComponent(latest.id)}`, { headers: { Accept: "application/json" } });
    if (!det.ok) return { ip: null as string | null, status: "ACTIVE", simulated: false };
    const d = (await det.json()) as { terminal_ip?: string };
    return { ip: d.terminal_ip || null, status: "ACTIVE", simulated: false };
  });

type ConsoleRequest = (config: never, path: string, init?: RequestInit) => Promise<Response>;

/** Aeris Subscription Search: resolve an ICCID to its IMSI and current state. */
async function findSubscription(request: unknown, config: unknown, iccid: string) {
  // Aeris Subscription Search: identifierType must be "ICC" (ICCID), per the published spec.
  const res = await (request as ConsoleRequest)(config as never, "/subscriptions/details", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ identifierType: "ICC", identifierValues: [iccid] }),
  });
  if (!res.ok) throw new Error(`SIM lookup failed (${res.status})`);
  const j = (await res.json()) as { subscriptions?: { imsi?: string; state?: string }[] };
  const sub = j.subscriptions?.[0];
  if (!sub?.imsi) throw new Error("No SIM found in Console Connect for that ICCID");
  return { imsi: sub.imsi, state: sub.state };
}
