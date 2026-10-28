import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { isPrivateIp, runJob } from "@/lib/jobs";
import { PageHeader, meta } from "@/components/PageHeader";
import { HelperOfflineNote } from "@/components/HelperStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/snmp-walk")({
  head: () => meta("SNMP Walk", "Run SNMP walks against a router and read the results."),
  component: SnmpWalk,
});

function SnmpWalk() {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("2161");
  const [community, setCommunity] = useState("public");
  const [oid, setOid] = useState(".1.3.6.1.4.1.53318.100.1.0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<{ oid: string; value: string }[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setRows([]);
    try {
      if (!isPrivateIp(host)) throw new Error("Enter a private IP address.");
      const oids = oid.split(/[,\s]+/).filter(Boolean);
      const j = await runJob("snmp_walk", { ip: host, port: Number(port) || 161, community, oids });
      if (j.status !== "done") throw new Error(j.error ?? "SNMP walk failed");
      const r = j.result as { results: { oid: string; value: string }[]; errors?: string[] };
      setRows(r.results ?? []);
      if (r.errors?.length) setError(r.errors.join("; "));
      else if (!r.results?.length) setError("SNMP returned no results.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Diagnostics" title="SNMP Walk" />
      <div className="space-y-6">
        <HelperOfflineNote />
        <form onSubmit={submit} className="panel grid gap-4 p-5 sm:grid-cols-4">
          <div className="space-y-2 sm:col-span-2"><Label>Host IP</Label><Input className="font-mono" value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.1" /></div>
          <div className="space-y-2"><Label>Port</Label><Input className="font-mono" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="space-y-2"><Label>Community</Label><Input className="font-mono" value={community} onChange={(e) => setCommunity(e.target.value)} /></div>
          <div className="space-y-2 sm:col-span-4"><Label>OIDs (comma or space separated)</Label><Input className="font-mono" value={oid} onChange={(e) => setOid(e.target.value)} /></div>
          <Button type="submit" disabled={busy || !host} className="sm:col-span-4">{busy ? "Walking…" : "Run SNMP walk"}</Button>
        </form>
        {error && <p className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
        {rows.length > 0 && (
          <div className="panel divide-y font-mono text-xs">
            {rows.map((r, i) => (
              <div key={i} className="grid gap-2 px-4 py-2 sm:grid-cols-2"><span className="text-muted-foreground">{r.oid}</span><span className="break-all">{r.value}</span></div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
