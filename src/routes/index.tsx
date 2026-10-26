import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { activateSim, applyFirewall, applyNtp, getSimIp } from "@/lib/activation.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SIM Activation — UR35 Provisioning" },
      { name: "description", content: "Activate IoT SIMs and provision UR35 routers with firewall and NTP settings." },
      { property: "og:title", content: "SIM Activation — UR35 Provisioning" },
      { property: "og:description", content: "Activate IoT SIMs and provision UR35 routers in one flow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const STEPS = [
  "Activate SIM",
  "Wait for IP address",
  "SIM active",
  "Apply firewall rules",
  "Apply NTP settings",
  "Complete",
];
type State = "idle" | "running" | "done" | "error";

function Index() {
  const [iccid, setIccid] = useState("");
  const [states, setStates] = useState<State[]>(STEPS.map(() => "idle"));
  const [ip, setIp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [busy, setBusy] = useState(false);

  const activate = useServerFn(activateSim);
  const poll = useServerFn(getSimIp);
  const fw = useServerFn(applyFirewall);
  const ntp = useServerFn(applyNtp);

  const set = (i: number, s: State) => setStates((p) => p.map((v, j) => (j === i ? s : v)));

  async function run() {
    setBusy(true);
    setError(null);
    setIp(null);
    setStates(STEPS.map(() => "idle"));
    let i = 0;
    try {
      set(0, "running");
      const a = await activate({ data: { iccid } });
      setSimulated(a.simulated);
      set(0, "done");

      i = 1;
      set(1, "running");
      let got: string | null = null;
      for (let attempt = 0; attempt < 60 && !got; attempt++) {
        const r = await poll({ data: { iccid, attempt } });
        got = r.ip;
        if (!got) await new Promise((res) => setTimeout(res, 2000));
      }
      if (!got) throw new Error("Timed out waiting for an IP address");
      setIp(got);
      set(1, "done");
      set(2, "done");

      i = 3;
      set(3, "running");
      await fw({ data: { ip: got } });
      set(3, "done");

      i = 4;
      set(4, "running");
      await ntp({ data: { ip: got } });
      set(4, "done");
      set(5, "done");
    } catch (e) {
      set(i, "error");
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const complete = states[5] === "done";
  const valid = /^\d{18,22}$/.test(iccid);

  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground">
      <div className="mx-auto max-w-xl">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">UR35 · Provisioning</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">SIM Activation</h1>

        <section className="panel mt-8 p-5">
          <label htmlFor="iccid" className="text-sm text-muted-foreground">ICCID</label>
          <input
            id="iccid"
            inputMode="numeric"
            value={iccid}
            disabled={busy}
            onChange={(e) => setIccid(e.target.value.replace(/\D/g, ""))}
            placeholder="8963…"
            className="mt-2 w-full rounded-md border border-input bg-input/30 px-4 py-3 font-mono text-lg tracking-wider outline-none focus:border-primary"
          />
          <button onClick={run} disabled={!valid || busy} className="btn-primary mt-4 w-full">
            {busy ? "Working…" : complete ? "Activate another" : "Activate SIM"}
          </button>
          {iccid && !valid && <p className="mt-2 text-xs text-muted-foreground">ICCID must be 18–22 digits.</p>}
        </section>

        <ol className="mt-6 space-y-2">
          {STEPS.map((s, i) => (
            <li key={s} className="panel flex items-center gap-4 px-4 py-3" data-state={states[i]}>
              <span className="step-dot">{states[i] === "done" ? "✓" : states[i] === "error" ? "!" : i + 1}</span>
              <span className="flex-1">{s}</span>
              {i === 2 && states[2] === "done" && <span className="badge-active">ACTIVE</span>}
              {i === 1 && ip && <span className="font-mono text-sm text-primary">{ip}</span>}
              {states[i] === "running" && <span className="spinner" />}
            </li>
          ))}
        </ol>

        {error && <p className="mt-4 rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
        {complete && (
          <div className="panel mt-6 p-5 text-center">
            <p className="text-2xl font-bold text-primary">Process complete</p>
            <p className="mt-1 font-mono text-sm text-muted-foreground">{iccid} → {ip}</p>
          </div>
        )}
        {simulated && (
          <p className="mt-6 text-center text-xs text-muted-foreground">Test mode: no live credentials connected — responses are simulated.</p>
        )}
      </div>
    </main>
  );
}
