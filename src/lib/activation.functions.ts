import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { matchCustomFields } from "@/lib/sim-custom-fields";
import { ConsoleRateLimitError } from "@/lib/console-rate-limit";
import { changeState, findSubscription } from "@/lib/sim-subscription";

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
    const { memberConsoleConfig, createConsoleRequest } = await import("@/lib/console-connect.server");
    const config = await memberConsoleConfig(context.supabase, context.userId, "sim_activation");
    const cfg = config.apiUrl && config.username && config.password;
    if (!cfg) {
      await wait(1200);
      return { ok: true, simulated: true, alreadyActive: false, labelWarning: null as string | null };
    }
    const request = createConsoleRequest(config);
    const sub = await findSubscription(request, data.iccid);
    if (sub.state === "ACTIVE") {
      return { ok: true, simulated: false, alreadyActive: true, labelWarning: null as string | null };
    }
    await changeState(request, sub.imsi, "ACTIVE");
    // Best effort: write the existing "Label" custom field (e.g. the account uses "Label#")
    // with the Site ID via Aeris Subscription Custom Fields API. Never blocks activation.
    // Equipment (GPS-Battery / GPS-Genset) is not sent to Console Connect.
    let labelWarning: string | null = null;
    if (data.label) {
      // Give Console Connect time to process activation before updating the label.
      // IP assignment is still confirmed by the separate bounded IP polling step.
      await wait(5_000);
      try {
        // Resolve the exact existing custom field (e.g. the account uses "Label#").
        const list = await request("/subscriptions/custom-fields", { headers: { Accept: "application/json" } });
        if (!list.ok) throw new Error(`fields ${list.status}`);
        const items = ((await list.json()) as { items?: { id?: string | number; fieldName?: string }[] }).items ?? [];
        const { customFields, missing } = matchCustomFields(items, { label: data.label });
        const problems: string[] = [];
        if (missing.length) problems.push(`no "${missing.join('" or "')}" field exists in Console Connect`);
        if (customFields.length) {
          const r = await request("/subscriptions/custom-fields/requests", {
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
  .inputValidator((d: { iccid: string; attempt: number }) => {
    if (!validIccid(d.iccid)) throw new Error("ICCID must be 18–22 digits");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { memberConsoleConfig, createConsoleRequest } = await import("@/lib/console-connect.server");
    const { findSimIp } = await import("@/lib/sim-ip.server");
    const config = await memberConsoleConfig(context.supabase, context.userId, "sim_activation");
    const cfg = config.apiUrl && config.username && config.password;
    if (!cfg) {
      await wait(800);
      if (data.attempt < 3) return { ip: null as string | null, status: "PENDING", simulated: true };
      const n = Number(data.iccid.slice(-4)) || 1;
      return { ip: `10.${(n >> 8) % 255}.${n % 255}.${((data.attempt * 7) % 250) + 2}`, status: "ACTIVE", simulated: true };
    }
    // One token per complete check, not a new sign-in for every event request.
    try {
    const request = createConsoleRequest(config);
    const sub = await findSubscription(request, data.iccid);
    if (sub.state !== "ACTIVE") return { ip: null as string | null, status: sub.state ?? "PENDING", simulated: false };
    const result = await findSimIp(request, sub.imsi, sub.ips);
    return { ip: result.ip, status: "ACTIVE", simulated: false };
    } catch (error) {
      if (error instanceof ConsoleRateLimitError) {
        return { ip: null, status: "RATE_LIMITED", simulated: false, retryAfterMs: error.retryAfterMs };
      }
      throw error;
    }
  });

/**
 * Router activations must not leave a usable SIM behind when the firewall step
 * fails: the page suspends it, and a retry resumes it before re-applying rules.
 */
export const setRouterSimState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { iccid: string; state: "PAUSE" | "ACTIVE" }) => {
    if (!validIccid(d.iccid)) throw new Error("ICCID must be 18–22 digits");
    if (d.state !== "PAUSE" && d.state !== "ACTIVE") throw new Error("Unsupported SIM state");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { memberConsoleConfig, createConsoleRequest } = await import("@/lib/console-connect.server");
    const config = await memberConsoleConfig(context.supabase, context.userId, "sim_activation");
    if (!(config.apiUrl && config.username && config.password)) throw new Error("Console Connect is not configured; SIM state could not be confirmed");
    const request = createConsoleRequest(config);
    const sub = await findSubscription(request, data.iccid);
    if (sub.state !== data.state) await changeState(request, sub.imsi, data.state);
    // State-change requests are asynchronous. Never claim Pause before provider readback.
    if (data.state === "PAUSE" && sub.state !== "PAUSE") {
      for (let attempt = 0; attempt < 12; attempt++) {
        await wait(5_000);
        const updated = await findSubscription(request, data.iccid);
        if (updated.state === "PAUSE") return { ok: true, simulated: false };
      }
      throw new Error("Pause was requested but Console Connect has not confirmed it; check the SIM in Console Connect");
    }
    return { ok: true, simulated: false };
  });


/**
 * Closes unfinished activations: the caller's own open runs when starting a new one,
 * or one specific run whose 3-minute retry window ran out on the page.
 */
export const closeUnfinishedActivations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string | undefined }) => {
    if (d.id !== undefined && !/^[0-9a-f-]{36}$/i.test(d.id)) throw new Error("Invalid activation");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { memberConsoleConfig } = await import("@/lib/console-connect.server");
    const { closeActivations } = await import("@/lib/activation-sweep.server");
    const config = await memberConsoleConfig(context.supabase, context.userId, "sim_activation");
    let q = context.supabase.from("sim_activations").select("id,iccid,equipment,sim_activated,simulated,status")
      .is("finished_at", null).eq("created_by", context.userId).in("status", ["running", "waiting_ip", "needs_retry"]);
    if (data.id) q = q.eq("id", data.id);
    const { data: rows } = await q.limit(10);
    return closeActivations(context.supabase, config, rows ?? [], data.id ? "No retry within 3 minutes" : "A new activation was started");
  });
