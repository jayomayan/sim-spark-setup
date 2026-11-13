import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createConsoleRequest, readConsoleConfig } from "@/lib/console-connect.server";
import { changeState, findSubscription } from "@/lib/sim-subscription";
import { OPEN_STATUSES, RETRY_WINDOW_MS, needsPause } from "@/lib/activation-process";

type Row = { id: string; iccid: string; equipment: string[]; sim_activated: boolean; simulated: boolean; status: string };
type Config = Awaited<ReturnType<typeof readConsoleConfig>>;

/** Claim each open run once, pause Router SIMs we turned on, and mark the run unfinished. */
export async function closeActivations(db: SupabaseClient<Database>, config: Config, rows: Row[], reason: string) {
  let closed = 0;
  const configured = Boolean(config.apiUrl && config.username && config.password);
  const request = configured ? createConsoleRequest(config) : null;
  for (const row of rows) {
    const { data: claimed } = await db.from("sim_activations").update({ status: "terminating", last_activity_at: new Date().toISOString() })
      .eq("id", row.id).in("status", [...OPEN_STATUSES]).is("finished_at", null).select("id").maybeSingle();
    if (!claimed) continue;
    let paused = false;
    let note = `Unfinished: ${reason}.`;
    if (needsPause(row)) {
      try {
        if (!request) throw new Error("Console Connect is not configured");
        const sub = await findSubscription(request, row.iccid);
        if (sub.state !== "PAUSE") await changeState(request, sub.imsi, "PAUSE");
        paused = true;
        note += " SIM set to Pause.";
      } catch (e) {
        note += ` WARNING: Pause failed (${e instanceof Error ? e.message.slice(0, 120) : "error"}). Pause the SIM in Console Connect.`;
      }
    }
    await db.from("sim_activations").update({ status: "unfinished", sim_paused: paused, error: note, finished_at: new Date().toISOString() }).eq("id", row.id);
    closed++;
  }
  return { closed };
}

/** Runs from helper check-ins so abandoned runs are closed even when every browser is gone. */
export async function sweepStaleActivations(db: SupabaseClient<Database>) {
  const cutoff = new Date(Date.now() - RETRY_WINDOW_MS).toISOString();
  const { data: rows } = await db.from("sim_activations").select("id,iccid,equipment,sim_activated,simulated,status")
    .is("finished_at", null).in("status", [...OPEN_STATUSES]).lt("last_activity_at", cutoff).order("last_activity_at").limit(5);
  if (!rows?.length) return { closed: 0 };
  return closeActivations(db, await readConsoleConfig(db, "sim_activation"), rows, "No retry within 3 minutes");
}
