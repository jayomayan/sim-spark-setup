import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { activateSim, getSimIp } from "@/lib/activation.functions";
import { runJob } from "@/lib/jobs";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, meta } from "@/components/PageHeader";
import { HelperOfflineNote } from "@/components/HelperStatus";
import { IP_WAIT_POLL_MS, ipWaitOpen, ipWaitSecondsLeft } from "@/lib/ip-wait";

export const Route = createFileRoute("/_authenticated/sim-activation")({
  head: () => meta("SIM Activation", "Activate an IoT SIM, wait for its assigned IP address, then apply firewall and NTP settings to the router."),
  component: SimActivation,
});

const STEPS = ["Activate SIM", "Wait for IP address", "SIM active", "Apply firewall rules", "Apply NTP settings", "Complete"];
type State = "idle" | "running" | "done" | "error" | "skipped" | "waiting";

const EQUIPMENT = [
  { key: "ur35", label: "Router" },
  { key: "gps_battery", label: "GPS-Battery" },
  { key: "gps_genset", label: "GPS-Genset" },
] as const;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function SimActivation() {
  const qc = useQueryClient();
  const [iccid, setIccid] = useState("");
  const [siteId, setSiteId] = useState("");
  const [equipment, setEquipment] = useState<string>("ur35");
  const [states, setStates] = useState<State[]>(STEPS.map(() => "idle"));
  const [ip, setIp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waitingForIp, setWaitingForIp] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [recordId, setRecordId] = useState<string | null>(null);
  const stepRef = useRef(0);
  const ipRef = useRef<string | null>(null);
  const activate = useServerFn(activateSim);
  const poll = useServerFn(getSimIp);

  const history = useQuery({
    queryKey: ["sim_activations"],
    queryFn: async () => (await supabase.from("sim_activations").select("*").order("created_at", { ascending: false }).limit(10)).data ?? [],
  });

  const set = (i: number, s: State) => {
    stepRef.current = i;
    setStates((p) => p.map((v, j) => (j === i ? s : v)));
  };
  const showIp = (v: string | null) => {
    ipRef.current = v;
    setIp(v);
  };

  const finishRecord = (id: string | null, patch: { status: string; ip?: string | null; error?: string | null; simulated?: boolean }) =>
    id ? supabase.from("sim_activations").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id) : Promise.resolve();

  async function applyRouterSettings(got: string, sim: boolean, id: string | null) {
    if (equipment === "ur35") {
      for (const [step, type] of [[3, "ur35_firewall"], [4, "ur35_ntp"]] as const) {
        set(step, "running");
        if (sim) await wait(1200);
        else {
          const j = await runJob(type, { ip: got });
          if (j.status !== "done") throw new Error(j.error ?? "Router rejected the settings");
        }
        set(step, "done");
      }
    } else {
      set(3, "skipped");
      set(4, "skipped");
    }
    set(5, "done");
    await finishRecord(id, { status: "complete", ip: got, simulated: sim });
  }

  /** Check Console Connect for up to two minutes, then let the user decide whether to wait again. */
  async function waitForIp(sim: boolean, id: string | null) {
    set(1, "running");
    setSecondsLeft(ipWaitSecondsLeft(0));
    const started = Date.now();
    let attempt = 0;
    let got: string | null = null;
    while (ipWaitOpen(Date.now() - started)) {
      const r = await poll({ data: { iccid, attempt: attempt++ } });
      got = r.ip;
      if (got) break;
      setSecondsLeft(ipWaitSecondsLeft(Date.now() - started));
      await wait(IP_WAIT_POLL_MS);
    }
    if (!got) {
      set(1, "waiting");
      setWaitingForIp(true);
      if (id) await supabase.from("sim_activations").update({ status: "waiting_ip" }).eq("id", id);
      return;
    }
    showIp(got);
    set(1, "done");
    set(2, "done");
    await applyRouterSettings(got, sim, id);
  }

  async function failRun(e: unknown, id: string | null, sim: boolean) {
    set(stepRef.current, "error");
    const msg = e instanceof Error ? e.message : "Something went wrong";
    setError(msg);
    await finishRecord(id, { status: "failed", ip: ipRef.current, error: msg, simulated: sim });
  }

  async function run() {
    setBusy(true);
    setError(null);
    setWaitingForIp(false);
    setSimulated(false);
    showIp(null);
    setStates(STEPS.map(() => "idle"));
    let sim = false;
    let id: string | null = null;
    try {
      const { data: u } = await supabase.auth.getUser();
      const { data: rec } = await supabase
        .from("sim_activations")
        .insert({ iccid, site_id: siteId.trim(), equipment: [equipment], created_by: u.user?.id ?? null })
        .select("id")
        .single();
      id = rec?.id ?? null;
      setRecordId(id);
      set(0, "running");
      // Site ID goes to Console Connect's Label# field; equipment is not sent to Console Connect.
      const a = await activate({ data: { iccid, label: siteId.trim() } });
      sim = a.simulated;
      setSimulated(sim);
      set(0, "done");
      if (a.labelWarning) toast.warning(a.labelWarning);
      await waitForIp(sim, id);
    } catch (e) {
      await failRun(e, id, sim);
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["sim_activations"] });
    }
  }

  async function checkAgain() {
    setBusy(true);
    setError(null);
    setWaitingForIp(false);
    try {
      await waitForIp(simulated, recordId);
    } catch (e) {
      await failRun(e, recordId, simulated);
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["sim_activations"] });
    }
  }

  function startOver() {
    setWaitingForIp(false);
    setError(null);
    showIp(null);
    setStates(STEPS.map(() => "idle"));
    setSimulated(false);
    setRecordId(null);
    setSecondsLeft(0);
  }

  const complete = states[5] === "done";
  const locked = busy || waitingForIp;
  const visibleSteps = STEPS.map((label, i) => ({ label, i })).filter(({ i }) => equipment === "ur35" || (i !== 3 && i !== 4));
  const doneCount = visibleSteps.filter(({ i }) => states[i] === "done" || states[i] === "skipped").length;
  const valid = /^\d{18,22}$/.test(iccid) && siteId.trim().length > 0;

  return (
    <>
      <PageHeader kicker="UR35 · Provisioning" title="SIM Activation" />
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {equipment === "ur35" && <HelperOfflineNote />}
          <section className="panel p-5">
            <label htmlFor="iccid" className="text-sm text-muted-foreground">ICCID</label>
            <input id="iccid" inputMode="numeric" value={iccid} disabled={locked}
              onChange={(e) => setIccid(e.target.value.replace(/\D/g, ""))} placeholder="8963…"
              className="mt-2 w-full rounded-md border border-input bg-input/30 px-4 py-3 font-mono text-lg tracking-wider outline-none focus:border-primary" />
            <label htmlFor="site-id" className="mt-4 block text-sm text-muted-foreground">Site ID</label>
            <input id="site-id" value={siteId} disabled={locked}
              onChange={(e) => setSiteId(e.target.value)} placeholder="e.g. PH010065"
              className="mt-2 w-full rounded-md border border-input bg-input/30 px-4 py-3 font-mono text-lg tracking-wider outline-none focus:border-primary" />
            <fieldset className="mt-4">
              <legend className="text-sm text-muted-foreground">Equipment on site</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {EQUIPMENT.map((e) => (
                  <label key={e.key} className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-input/30 px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:text-primary">
                    <input type="radio" name="equipment" checked={equipment === e.key} disabled={locked}
                      onChange={() => setEquipment(e.key)}
                      className="accent-primary" />
                    {e.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <button onClick={run} disabled={!valid || locked} className="btn-primary mt-4 w-full">
              {busy ? "Working…" : complete ? "Activate another" : "Activate SIM"}
            </button>
            {iccid && !/^\d{18,22}$/.test(iccid) && <p className="mt-2 text-xs text-muted-foreground">ICCID must be 18–22 digits.</p>}
            {!siteId.trim() && <p className="mt-1 text-xs text-muted-foreground">Site ID is required.</p>}
          </section>
          <section className="panel p-5">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="font-semibold">Activation progress</span>
              <span className="font-mono text-muted-foreground">{doneCount} / {visibleSteps.length}</span>
            </div>
            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${(doneCount / visibleSteps.length) * 100}%` }} />
            </div>
            <ol className="stepper space-y-1">
              {visibleSteps.map(({ label: s, i }, n) => (
                <li key={s} className="flex items-center gap-4 px-3 py-2.5" data-state={states[i]}>
                  <span className="step-dot">
                    {states[i] === "running" ? <span className="spinner" /> : states[i] === "done" ? "✓" : states[i] === "error" ? "!" : states[i] === "skipped" ? "–" : states[i] === "waiting" ? "↻" : n + 1}
                  </span>
                  <span className="step-label flex-1 text-muted-foreground">{s}</span>
                  {i === 1 && states[1] === "running" && <span className="font-mono text-xs text-muted-foreground">{fmtClock(secondsLeft)} left</span>}
                  {i === 2 && states[2] === "done" && <span className="badge-active">ACTIVE</span>}
                  {i === 1 && ip && <span className="font-mono text-sm text-primary">{ip}</span>}
                  {i === 1 && waitingForIp && (
                    <button onClick={checkAgain} disabled={busy} className="btn-primary shrink-0 px-3 py-1.5 text-xs">Check for IP address again</button>
                  )}
                </li>
              ))}
            </ol>
            {waitingForIp && (
              <div className="mt-4 rounded-md border border-input bg-accent p-4">
                <p className="text-sm font-semibold text-accent-foreground">No IP address yet after 2 minutes</p>
                <p className="mt-1 text-sm text-accent-foreground/80">
                  The SIM is active in Console Connect, but the device hasn't come online yet, so no IP address was assigned.
                  Check again to wait another 2 minutes.
                </p>
                <button onClick={startOver} className="mt-3 w-full text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  Start over with a different SIM
                </button>
              </div>
            )}
          </section>
          {error && <p className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
          {complete && (
            <div className="panel p-5 text-center">
              <p className="text-2xl font-bold text-primary">Process complete</p>
              <p className="mt-1 font-mono text-sm text-muted-foreground">{iccid} → {ip} · {siteId.trim()}</p>
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
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {h.site_id ?? "—"}{h.equipment?.length ? ` · ${h.equipment.map((k) => EQUIPMENT.find((e) => e.key === k)?.label ?? k).join(", ")}` : ""}
                </p>
                <p className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>{h.ip ?? "—"}{h.simulated ? " · test" : ""}</span>
                  <span className={h.status === "complete" ? "text-primary" : h.status === "failed" ? "text-destructive" : ""}>
                    {h.status === "waiting_ip" ? "waiting" : h.status}
                  </span>
                </p>
              </div>
            )) : <p className="px-4 py-6 text-muted-foreground">None yet.</p>}
          </div>
        </aside>
      </div>
    </>
  );
}
