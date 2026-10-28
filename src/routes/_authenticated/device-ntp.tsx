import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { isPrivateIp, runJob } from "@/lib/jobs";
import { PageHeader, meta } from "@/components/PageHeader";
import { HelperOfflineNote } from "@/components/HelperStatus";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/device-ntp")({
  head: () => meta("Device NTP", "Push NTP clock settings to one or many routers at once."),
  component: DeviceNtp,
});

type Result = { ip: string; status: "ok" | "error" | "running"; message: string };

function DeviceNtp() {
  const [hosts, setHosts] = useState("");
  const [brand, setBrand] = useState("enetek");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const ips = [...new Set(hosts.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
    if (!ips.length) return setError("Please enter at least one Site IP.");
    const bad = ips.filter((ip) => !isPrivateIp(ip));
    if (bad.length) return setError(`Invalid or non-private IP(s): ${bad.join(", ")}`);
    setBusy(true);
    setResults(ips.map((ip) => ({ ip, status: "running", message: "Waiting…" })));
    await Promise.all(ips.map(async (ip) => {
      let r: Result;
      try {
        const j = await runJob("device_ntp", { ip, brand });
        r = j.status === "done" ? { ip, status: "ok", message: "NTP configuration submitted successfully." } : { ip, status: "error", message: j.error ?? "Failed" };
      } catch (err) {
        r = { ip, status: "error", message: err instanceof Error ? err.message : "Failed" };
      }
      setResults((p) => p.map((x) => (x.ip === ip ? r : x)));
    }));
    setBusy(false);
  }

  return (
    <>
      <PageHeader kicker="Configuration" title="Device NTP" />
      <div className="space-y-6">
        <HelperOfflineNote />
        <form onSubmit={submit} className="panel space-y-4 p-5">
          <div className="space-y-2"><Label>Site IPs (comma, space or one per line)</Label>
            <Textarea rows={4} className="font-mono" value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder={"10.0.0.1\n10.0.0.2"} /></div>
          <div className="space-y-2"><Label>Device brand</Label>
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="enetek">Enetek</SelectItem>
                <SelectItem value="vnt" disabled>VNT</SelectItem>
                <SelectItem value="eltek" disabled>Eltek</SelectItem>
                <SelectItem value="huawei" disabled>Huawei</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Applying…" : "Apply NTP settings"}</Button>
        </form>
        {error && <p className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
        {results.length > 0 && (
          <div className="panel divide-y text-sm">
            {results.map((r) => (
              <div key={r.ip} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="font-mono">{r.ip}</span>
                <span className={r.status === "ok" ? "text-primary" : r.status === "error" ? "text-destructive" : "text-muted-foreground"}>{r.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
