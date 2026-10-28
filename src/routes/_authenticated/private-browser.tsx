import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { lookupSite } from "@/lib/aeris.functions";
import { isPrivateIp, runJob } from "@/lib/jobs";
import { PageHeader, meta } from "@/components/PageHeader";
import { HelperOfflineNote } from "@/components/HelperStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/private-browser")({
  head: () => meta("Private Browser", "Find a site's router by Site ID or private IP and check it's reachable."),
  component: PrivateBrowser,
});

type Ping = { success: boolean; packet_loss?: string; rtt?: { min: string; avg: string; max: string }; raw_output?: string[] };

function PrivateBrowser() {
  const lookup = useServerFn(lookupSite);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ip, setIp] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [ping, setPing] = useState<Ping | null>(null);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setIp(null); setNetwork(null); setPing(null);
    try {
      let target = query.trim();
      if (/^PH/i.test(target)) {
        const r = await lookup({ data: { siteId: target.toUpperCase() } });
        if (r.error || !r.ip) throw new Error(r.error ?? "No IP found");
        target = r.ip; setNetwork(r.network);
      }
      if (!isPrivateIp(target)) throw new Error("Please enter a Site ID or a private IP address.");
      setIp(target);
      const j = await runJob("ping", { ip: target }, { timeoutMs: 60_000 });
      if (j.status !== "done") throw new Error(j.error ?? "Ping failed");
      setPing(j.result as Ping);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Remote access" title="Private Browser" />
      <div className="space-y-6">
        <HelperOfflineNote />
        <form onSubmit={connect} className="panel flex flex-col gap-3 p-5 sm:flex-row">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Site ID (PH010010) or private IP (10.x.x.x)" className="font-mono" />
          <Button type="submit" disabled={busy || !query.trim()}>{busy ? "Connecting…" : "Connect"}</Button>
        </form>
        {error && <p className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
        {ip && (
          <div className="panel grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Router IP" value={ip} />
            <Field label="Network" value={network ?? "—"} />
            <Field label="Reachable" value={ping ? (ping.success ? "Yes" : "No") : busy ? "Checking…" : "—"} highlight={ping?.success} />
            {ping?.packet_loss && <Field label="Packet loss" value={ping.packet_loss} />}
            {ping?.rtt && <Field label="Round trip (avg)" value={ping.rtt.avg} />}
            <div className="flex items-end gap-2">
              <Button asChild variant="secondary" size="sm"><a href={`http://${ip}`} target="_blank" rel="noreferrer">Open HTTP</a></Button>
              <Button asChild variant="secondary" size="sm"><a href={`https://${ip}`} target="_blank" rel="noreferrer">Open HTTPS</a></Button>
            </div>
          </div>
        )}
        {ping?.raw_output && <pre className="panel overflow-x-auto p-4 font-mono text-xs text-muted-foreground">{ping.raw_output.join("\n")}</pre>}
        {ip && <p className="text-xs text-muted-foreground">The Open buttons work when your computer is on the company network or VPN.</p>}
      </div>
    </>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}
