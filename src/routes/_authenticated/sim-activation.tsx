import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { activateSim, getSimIp } from "@/lib/activation.functions";
import { runJob } from "@/lib/jobs";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, meta } from "@/components/PageHeader";
import { HelperOfflineNote } from "@/components/HelperStatus";

export const Route = createFileRoute("/_authenticated/sim-activation")({
  head: () => meta("SIM Activation", "Activate an IoT SIM and provision its UR35 router with firewall and NTP settings."),
  component: SimActivation,
});

const STEPS = ["Activate SIM", "Wait for IP address", "SIM active", "Apply firewall rules", "Apply NTP settings", "Complete"];
type State = "idle" | "running" | "done" | "error" | "skipped";

const EQUIPMENT = [
  { key: "ur35", label: "UR35" },
  { key: "gps_battery", label: "GPS-Battery" },
  { key: "gps_genset", label: "GPS-Genset" },
] as const;

function SimActivation() {
  const qc = useQueryClient();
  const [iccid, setIccid] = useState("");
  const [siteId, setSiteId] = useState("");
  const [ticked, setTicked] = useState<Record<string, boolean>>({ ur35: true, gps_battery: false, gps_genset: false });
  const [states, setStates] = useState<State[]>(STEPS.map(() => "idle"));
  const [ip, setIp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [busy, setBusy] = useState(false);
  const activate = useServerFn(activateSim);
  const poll = useServerFn(getSimIp);

  const history = useQuery({
    queryKey: ["sim_activations"],
    queryFn: async () => (await supabase.from("sim_activations").select("*").order("created_at", { ascending: false }).limit(10)).data ?? [],
  });

  const set = (i: number, s: State) => setStates((p) => p.map((v, j) => (j === i ? s : v)));

  async function run() {
    setBusy(true); setError(null); setIp(null); setStates(STEPS.map(() => "idle"));
    const equipment = EQUIPMENT.filter((e) => ticked[e.key]).map((e) => e.key);
    const { data: u } = await supabase.auth.getUser();
    const { data: rec } = await supabase.from("sim_activations")
      .insert({ iccid, site_id: siteId.trim(), equipment, created_by: u.user?.id ?? null }).select("id").single();
    const finish = (patch: { status: string; ip?: string | null; error?: string | null; simulated?: boolean }) =>
      rec && supabase.from("sim_activations").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", rec.id);
    let i = 0; let got: string | null = null; let sim = false;
    try {
      set(0, "running");
      const a = await activate({ data: { iccid } });
      sim = a.simulated; setSimulated(sim); set(0, "done");

      i = 1; set(1, "running");
      for (let attempt = 0; attempt < 60 && !got; attempt++) {
        const r = await poll({ data: { iccid, attempt } });
        got = r.ip;
        if (!got) await new Promise((res) => setTimeout(res, 2000));
      }
      if (!got) throw new Error("Timed out waiting for an IP address");
      setIp(got); set(1, "done"); set(2, "done");

      for (const [step, type] of [[3, "ur35_firewall"], [4, "ur35_ntp"]] as const) {
        i = step; set(step, "running");
        if (sim) await new Promise((r) => setTimeout(r, 1200));
        else {
          const j = await runJob(type, { ip: got });
          if (j.status !== "done") throw new Error(j.error ?? "Router rejected the settings");
        }
        set(step, "done");
      }
      set(5, "done");
      await finish({ status: "complete", ip: got, simulated: sim });
    } catch (e) {
      set(i, "error");
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setError(msg);
      await finish({ status: "failed", ip: got, error: msg, simulated: sim });
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["sim_activations"] });
    }
  }

  const complete = states[5] === "done";
  const doneCount = states.filter((s) => s === "done").length;
  const valid = /^\d{18,22}$/.test(iccid);

  return (
    <>
      <PageHeader kicker="UR35 · Provisioning" title="SIM Activation" />
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <HelperOfflineNote />
          <section className="panel p-5">
            <label htmlFor="iccid" className="text-sm text-muted-foreground">ICCID</label>
            <input id="iccid" inputMode="numeric" value={iccid} disabled={busy}
              onChange={(e) => setIccid(e.target.value.replace(/\D/g, ""))} placeholder="8963…"
              className="mt-2 w-full rounded-md border border-input bg-input/30 px-4 py-3 font-mono text-lg tracking-wider outline-none focus:border-primary" />
            <button onClick={run} disabled={!valid || busy} className="btn-primary mt-4 w-full">
              {busy ? "Working…" : complete ? "Activate another" : "Activate SIM"}
            </button>
            {iccid && !valid && <p className="mt-2 text-xs text-muted-foreground">ICCID must be 18–22 digits.</p>}
          </section>
          <section className="panel p-5">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="font-semibold">Activation progress</span>
              <span className="font-mono text-muted-foreground">{doneCount} / {STEPS.length}</span>
            </div>
            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
            </div>
            <ol className="stepper space-y-1">
              {STEPS.map((s, i) => (
                <li key={s} className="flex items-center gap-4 px-3 py-2.5" data-state={states[i]}>
                  <span className="step-dot">
                    {states[i] === "running" ? <span className="spinner" /> : states[i] === "done" ? "✓" : states[i] === "error" ? "!" : i + 1}
                  </span>
                  <span className="step-label flex-1 text-muted-foreground">{s}</span>
                  {i === 2 && states[2] === "done" && <span className="badge-active">ACTIVE</span>}
                  {i === 1 && ip && <span className="font-mono text-sm text-primary">{ip}</span>}
                </li>
              ))}
            </ol>
          </section>
          {error && <p className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
          {complete && (
            <div className="panel p-5 text-center">
              <p className="text-2xl font-bold text-primary">Process complete</p>
              <p className="mt-1 font-mono text-sm text-muted-foreground">{iccid} → {ip}</p>
            </div>
          )}
          {simulated && <p className="text-center text-xs text-muted-foreground">Test mode: IoT Console Connect isn't connected yet, so these results are simulated.</p>}
        </div>
        <aside>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Recent activations</h2>
          <div className="panel divide-y text-sm">
            {history.data?.length ? history.data.map((h) => (
              <div key={h.id} className="px-4 py-3">
                <p className="font-mono text-xs">{h.iccid}</p>
                <p className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>{h.ip ?? "—"}{h.simulated ? " · test" : ""}</span>
                  <span className={h.status === "complete" ? "text-primary" : h.status === "failed" ? "text-destructive" : ""}>{h.status}</span>
                </p>
              </div>
            )) : <p className="px-4 py-6 text-muted-foreground">None yet.</p>}
          </div>
        </aside>
      </div>
    </>
  );
}
