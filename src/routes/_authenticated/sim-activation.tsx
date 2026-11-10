import { createFileRoute, useRouteContext } from "@tanstack/react-router";
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
import { routerProgressLabel, type RouterProgressEvent } from "@/lib/router-progress";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/sim-activation")({
  head: () => meta("SIM Activation", "Activate an IoT SIM, wait for its assigned IP address, then apply firewall rules and optional miscellaneous settings to the router."),
  component: SimActivationPage,
});

function SimActivationPage() {
  const { isAdmin } = useRouteContext({ from: "/_authenticated" });
  return <SimActivation isAdmin={isAdmin} />;
}

const STEPS = ["Activate SIM", "Wait for IP address", "SIM active", "Apply firewall rules", "Apply miscellaneous settings", "Complete"];
const FIREWALL = 3;
const MISC = 4;
const COMPLETE = 5;
type State = "idle" | "running" | "done" | "error" | "skipped" | "waiting";

const EQUIPMENT = [
  { key: "ur35", label: "Router" },
  { key: "gps_battery", label: "GPS-Battery" },
  { key: "gps_genset", label: "GPS-Genset" },
  { key: "other", label: "Other" },
] as const;

// "Other" is an admin-only choice: it skips the IP wait and firewall rules.
const ADMIN_ONLY_EQUIPMENT = new Set<string>(["other"]);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Live status line plus the scrollable milestone list under a router step. */
function RouterStepDetails({ label, status, events, failed, running }: {
  label: string; status: string; events: RouterProgressEvent[]; failed: boolean; running: boolean;
}) {
  if (!status && !events.length) return null;
  return (
    <>
      {status && <span role="status" aria-live="polite" className={`max-w-full text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}>{status}</span>}
      {events.length > 0 && (
        <ol aria-label={label} className="max-h-48 w-full space-y-1 overflow-y-auto border-l border-border pl-3 text-xs text-muted-foreground sm:ml-10">
          {events.map((event, index) => (
            <li key={index} className="flex items-start gap-2 break-words">
              <span aria-hidden="true" className="shrink-0">{index === events.length - 1 && running && event.stage !== "closed" ? "›" : "·"}</span>
              <span>{routerProgressLabel(event)}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function SimActivation({ isAdmin = false }: { isAdmin?: boolean }) {
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
  const [firewallStatus, setFirewallStatus] = useState("");
  const [firewallProgress, setFirewallProgress] = useState<RouterProgressEvent[]>([]);
  const [miscStatus, setMiscStatus] = useState("");
  const [miscProgress, setMiscProgress] = useState<RouterProgressEvent[]>([]);
  const stepRef = useRef(0);
  const runningRef = useRef(false);
  const routerJobRef = useRef<string | null>(null);
  const miscJobRef = useRef<string | null>(null);
  const ipRef = useRef<string | null>(null);
  const activate = useServerFn(activateSim);
  const poll = useServerFn(getSimIp);

  // The on/off switch lives in Admin Settings; the view exposes only that flag to signed-in users.
  const miscFlags = useQuery({
    queryKey: ["router_settings_flags"],
    queryFn: async () => {
      const { data, error: readError } = await supabase.from("router_settings_flags").select("misc_enabled").maybeSingle();
      if (readError) throw new Error(readError.message);
      return Boolean(data?.misc_enabled);
    },
    retry: false,
    staleTime: 60_000,
  });
  const miscEnabled = miscFlags.data === true;

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

  async function runFirewall(got: string, sim: boolean) {
    set(FIREWALL, "running");
    setFirewallProgress([]);
    setFirewallStatus(sim ? "Applying · test mode" : "Queueing for helper…");
    if (sim) await wait(1200);
    else {
      // Router SSH may need a few minutes after a new cellular IP; the helper retries for up to 3.
      const j = await runJob("ur35_firewall", { ip: got }, {
        timeoutMs: 300_000,
        onQueued: (jobId) => { routerJobRef.current = jobId; },
        onProgress: (events) => {
          setFirewallProgress(events);
          const latest = events.at(-1);
          if (latest && latest.stage !== "closed") setFirewallStatus(routerProgressLabel(latest));
        },
        onStatus: (status) => {
          setFirewallStatus(status === "running" ? "Waiting for router, then applying rules…" : status === "done" ? "Applied and verified" : status === "failed" ? "Failed" : "Waiting for helper…");
        },
      });
      routerJobRef.current = null;
      if (j.status !== "done") throw new Error(j.error ?? "Router rejected the settings");
    }
    setFirewallStatus(sim ? "Finished · test mode" : "Applied and verified");
    set(FIREWALL, "done");
  }

  async function runMisc(got: string, sim: boolean) {
    if (equipment !== "ur35" || !miscEnabled) {
      set(MISC, "skipped");
      return;
    }
    set(MISC, "running");
    setMiscProgress([]);
    setMiscStatus(sim ? "Applying · test mode" : "Queueing for helper…");
    if (sim) await wait(1200);
    else {
      const j = await runJob("ur35_misc", { ip: got }, {
        timeoutMs: 300_000,
        onQueued: (jobId) => { miscJobRef.current = jobId; },
        onProgress: (events) => {
          setMiscProgress(events);
          const latest = events.at(-1);
          if (latest && latest.stage !== "closed") setMiscStatus(routerProgressLabel(latest));
        },
        onStatus: (status) => {
          setMiscStatus(status === "running" ? "Waiting for router, then applying commands…" : status === "done" ? "Applied and verified" : status === "failed" ? "Failed" : "Waiting for helper…");
        },
      });
      miscJobRef.current = null;
      if (j.status !== "done") throw new Error(j.error ?? "Router rejected the miscellaneous settings");
    }
    setMiscStatus(sim ? "Finished · test mode" : "Applied and verified");
    set(MISC, "done");
  }

  async function applyRouterSettings(got: string, sim: boolean, id: string | null) {
    if (equipment === "ur35") {
      await runFirewall(got, sim);
      await runMisc(got, sim);
    } else {
      set(FIREWALL, "skipped");
      set(MISC, "skipped");
    }
    set(COMPLETE, "done");
    await finishRecord(id, { status: "complete", ip: got, simulated: sim, error: null });
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
    if (stepRef.current === FIREWALL) setFirewallStatus("Failed · see error below");
    if (stepRef.current === MISC) setMiscStatus("Failed · see error below");
    set(stepRef.current, "error");
    const msg = e instanceof Error ? e.message : "Something went wrong";
    setError(msg);
    await finishRecord(id, { status: "failed", ip: ipRef.current, error: msg, simulated: sim });
  }

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    setFirewallStatus("");
    setMiscStatus("");
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
      if (a.alreadyActive) throw new Error(`SIM with ICCID ${iccid} is already Active.`);
      sim = a.simulated;
      setSimulated(sim);
      set(0, "done");
      if (a.labelWarning) toast.warning(a.labelWarning);
      if (equipment === "other") {
        set(1, "skipped");
        set(2, "done");
        set(FIREWALL, "skipped");
        set(MISC, "skipped");
        await finishRecord(id, { status: "complete", ip: null, simulated: sim });
        set(COMPLETE, "done");
      } else {
        await waitForIp(sim, id);
      }
    } catch (e) {
      await failRun(e, id, sim);
    } finally {
      runningRef.current = false;
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["sim_activations"] });
    }
  }

  async function checkAgain() {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    setError(null);
    setWaitingForIp(false);
    try {
      await waitForIp(simulated, recordId);
    } catch (e) {
      await failRun(e, recordId, simulated);
    } finally {
      runningRef.current = false;
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["sim_activations"] });
    }
  }

  /** Retry one failed router step without re-activating the SIM or polling for the IP again. */
  async function retryRouterStep(step: number) {
    const target = ipRef.current;
    const jobRef = step === FIREWALL ? routerJobRef : miscJobRef;
    if (runningRef.current || !target || equipment !== "ur35" || states[step] !== "error") return;
    runningRef.current = true;
    setBusy(true);
    setError(null);
    try {
      // A browser wait can time out while the helper is still working. Never queue a duplicate.
      if (jobRef.current) {
        const { data: job, error: readError } = await supabase.from("agent_jobs")
          .select("status").eq("id", jobRef.current).single();
        if (readError || !job) throw new Error("Unable to check the previous router task. Try again shortly.");
        if (job.status !== "done" && job.status !== "failed") {
          throw new Error("The previous router task is still waiting or running. Retry once it finishes.");
        }
        jobRef.current = null;
        if (job.status === "done") {
          set(step, "done");
          (step === FIREWALL ? setFirewallStatus : setMiscStatus)("Applied and verified");
          if (step === FIREWALL) await runMisc(target, simulated);
          set(COMPLETE, "done");
          await finishRecord(recordId, { status: "complete", ip: target, simulated, error: null });
          return;
        }
      }
      if (step === FIREWALL) await applyRouterSettings(target, simulated, recordId);
      else {
        await runMisc(target, simulated);
        set(COMPLETE, "done");
        await finishRecord(recordId, { status: "complete", ip: target, simulated, error: null });
      }
    } catch (e) {
      await failRun(e, recordId, simulated);
    } finally {
      runningRef.current = false;
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["sim_activations"] });
    }
  }

  function startOver() {
    setFirewallProgress([]);
    setFirewallStatus("");
    setMiscProgress([]);
    setMiscStatus("");
    setWaitingForIp(false);
    setError(null);
    showIp(null);
    setStates(STEPS.map(() => "idle"));
    setSimulated(false);
    setRecordId(null);
    setSecondsLeft(0);
  }

  const complete = states[COMPLETE] === "done";
  const routerFailed = states[FIREWALL] === "error" || states[MISC] === "error";
  const locked = busy || waitingForIp || routerFailed;
  const visibleSteps = STEPS.map((label, i) => ({ label, i })).filter(({ i }) =>
    (i !== MISC || miscEnabled) && (equipment === "ur35" || (i !== FIREWALL && i !== MISC && (equipment !== "other" || i !== 1))),
  );
  const doneCount = visibleSteps.filter(({ i }) => states[i] === "done" || states[i] === "skipped").length;
  const options = EQUIPMENT.filter((e) => isAdmin || !ADMIN_ONLY_EQUIPMENT.has(e.key));
  const valid = /^\d{18,22}$/.test(iccid) && siteId.trim().length > 0;

  return (
    <>
      <PageHeader kicker="UR35 · Provisioning" title="SIM Activation" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          {equipment === "ur35" && <HelperOfflineNote />}
          <section className="panel p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="min-w-0">
            <label htmlFor="iccid" className="text-sm text-muted-foreground">ICCID</label>
            <input id="iccid" inputMode="numeric" value={iccid} disabled={locked}
              onChange={(e) => setIccid(e.target.value.replace(/\D/g, ""))} placeholder="8963…"
              className="mt-1 h-10 w-full rounded-md border border-input bg-input/30 px-3 font-mono text-base outline-none focus:border-primary" />
            </div>
            <div className="min-w-0">
            <label htmlFor="site-id" className="block text-sm text-muted-foreground">Site ID</label>
            <input id="site-id" value={siteId} disabled={locked}
              onChange={(e) => setSiteId(e.target.value)} placeholder="e.g. PH010065"
              className="mt-1 h-10 w-full rounded-md border border-input bg-input/30 px-3 font-mono text-base outline-none focus:border-primary" />
            </div>
            </div>
            <fieldset className="mt-3">
              <legend className="text-sm text-muted-foreground">EdgeSim to be used for</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {options.map((e) => (
                  <label key={e.key} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-input/30 px-2.5 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:text-primary">
                    <input type="radio" name="equipment" checked={equipment === e.key} disabled={locked}
                      onChange={() => setEquipment(e.key)}
                      className="accent-primary" />
                    {e.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <Button onClick={run} disabled={!valid || locked} className="mt-3 h-10 w-full font-semibold">
              {busy ? "Working…" : complete ? "Activate another" : "Activate SIM"}
            </Button>
            {iccid && !/^\d{18,22}$/.test(iccid) && <p className="mt-2 text-xs text-muted-foreground">ICCID must be 18–22 digits.</p>}
            {!siteId.trim() && <p className="mt-1 text-xs text-muted-foreground">Site ID is required.</p>}
          </section>
          <section className="panel p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold">Activation progress</span>
              <span className="font-mono text-muted-foreground">{doneCount} / {visibleSteps.length}</span>
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${(doneCount / visibleSteps.length) * 100}%` }} />
            </div>
            <ol className="stepper space-y-0.5 text-sm">
              {visibleSteps.map(({ label: s, i }, n) => (
                <li key={s} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5" data-state={states[i]}>
                  <span className="step-dot">
                    {states[i] === "running" ? <span className="spinner" /> : states[i] === "done" ? "✓" : states[i] === "error" ? "!" : states[i] === "skipped" ? "–" : states[i] === "waiting" ? "↻" : n + 1}
                  </span>
                  <span className="step-label flex-1 text-muted-foreground">{s}</span>
                  {i === FIREWALL && states[FIREWALL] === "error" && ip && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => retryRouterStep(FIREWALL)}>
                      <RotateCcw aria-hidden="true" />Retry firewall rules
                    </Button>
                  )}
                  {i === MISC && states[MISC] === "error" && ip && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => retryRouterStep(MISC)}>
                      <RotateCcw aria-hidden="true" />Retry miscellaneous settings
                    </Button>
                  )}
                  {i === FIREWALL && <RouterStepDetails label="Firewall progress details" status={firewallStatus} events={firewallProgress} failed={states[FIREWALL] === "error"} running={states[FIREWALL] === "running"} />}
                  {i === MISC && <RouterStepDetails label="Miscellaneous settings progress details" status={miscStatus} events={miscProgress} failed={states[MISC] === "error"} running={states[MISC] === "running"} />}
                  {i === 1 && states[1] === "running" && <span className="font-mono text-xs text-muted-foreground">{fmtClock(secondsLeft)} left</span>}
                  {i === 2 && states[2] === "done" && <span className="badge-active">ACTIVE</span>}
                  {i === 1 && ip && <span className="font-mono text-sm text-primary">{ip}</span>}
                  {i === 1 && states[1] === "error" && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={checkAgain}>
                      <RotateCcw aria-hidden="true" />Retry IP address check
                    </Button>
                  )}
                  {i === 1 && waitingForIp && (
                    <button onClick={checkAgain} disabled={busy} className="btn-primary shrink-0 px-3 py-1.5 text-xs">Check for IP address again</button>
                  )}
                </li>
              ))}
            </ol>
            {routerFailed && <Button variant="link" size="sm" disabled={busy} onClick={startOver} className="mt-3">Start over with a different SIM</Button>}
            {waitingForIp && (
              <div className="mt-3 rounded-md border border-input bg-accent p-3">
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
            <div className="panel p-4 text-center">
              <p className="text-xl font-bold text-primary">Process complete</p>
              <p className="mt-1 break-words font-mono text-sm text-muted-foreground">{iccid}{ip ? ` → ${ip}` : ""} · {siteId.trim()}</p>
            </div>
          )}
          {simulated && <p className="text-center text-xs text-muted-foreground">Test mode: IoT Console Connect isn't connected yet, so these results are simulated.</p>}
        </div>
        <aside className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Recent activations</h2>
          <div className="panel divide-y text-sm">
            {history.data?.length ? history.data.map((h) => (
              <div key={h.id} className="break-words px-3 py-2">
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
            )) : <p className="px-3 py-4 text-muted-foreground">None yet.</p>}
          </div>
        </aside>
      </div>
    </>
  );
}
