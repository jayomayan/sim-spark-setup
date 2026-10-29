import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ExternalLink, Camera, LoaderCircle, RefreshCw, Download, Activity, Server, History, ChevronDown } from "lucide-react";
import { lookupSite } from "@/lib/aeris.functions";
import { runJob } from "@/lib/jobs";
import { listSiteChecks, saveSiteCheck, type SiteCheck } from "@/lib/site-checks";
import { BROWSER_PORTS, captureResultSchema, isRouterIp, pingResultSchema, portLabel, routerUrl, type BrowserPort, type CaptureResult, type PingResult } from "@/lib/site-connectivity";
import { PageHeader, meta } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/site-connectivity-check")({
  head: () => meta("Site Connectivity Check", "Resolve Site IDs through Console Connect, test ping reachability and latency, and check screenshots of ports 80, 443, 8443 and 8080."),
  component: SiteConnectivityCheck,
});

type Tile = { state: "idle" | "loading" | "done" | "error"; capture?: CaptureResult; error?: string };
const emptyTiles = (): Record<BrowserPort, Tile> => ({ 80: { state: "idle" }, 443: { state: "idle" }, 8443: { state: "idle" }, 8080: { state: "idle" } });

function SiteConnectivityCheck() {
  const lookup = useServerFn(lookupSite);
  const { isAdmin } = useRouteContext({ from: "/_authenticated" });
  const [pingState, setPingState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ip, setIp] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [tiles, setTiles] = useState(emptyTiles);
  const [site, setSite] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  async function testPing(target: string): Promise<PingResult | null> {
    setPingState("loading"); setPingResult(null); setPingError(null);
    try {
      const job = await runJob("site_ping", { ip: target }, { timeoutMs: 60_000 });
      if (job.status === "done") {
        const result = pingResultSchema.parse(job.result);
        setPingResult(result); setPingState("done");
        return result;
      }
      setPingError(job.error ?? "Ping unavailable"); setPingState("error");
    } catch (err) { setPingError(err instanceof Error ? err.message : "Could not run the ping test. Please try again."); setPingState("error"); }
    return null;
  }

  async function browsePort(target: string, port: BrowserPort): Promise<CaptureResult | null> {
    setTiles((previous) => ({ ...previous, [port]: { state: "loading" } }));
    try {
      const job = await runJob("site_capture", { ip: target, port }, { timeoutMs: 180_000 });
      if (job.status === "done") {
        const capture = captureResultSchema.parse(job.result);
        if (capture.port !== port) throw new Error("Unexpected port");
        setTiles((previous) => ({ ...previous, [port]: { state: "done", capture } }));
        return capture;
      }
      setTiles((previous) => ({ ...previous, [port]: { state: "error", error: job.error ?? "Screenshot unavailable" } }));
    } catch (err) {
      setTiles((previous) => ({ ...previous, [port]: { state: "error", error: err instanceof Error ? err.message : "Could not capture this port. Please try again." } }));
    }
    return null;
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setIp(null); setNetwork(null); setSite(null); setTiles(emptyTiles());
    setPingState("idle"); setPingResult(null); setPingError(null);
    try {
      let target = query.trim();
      let siteId: string | null = null;
      let resolvedNetwork: string | null = null;
      if (/^PH/i.test(target)) {
        if (!/^PH[A-Z0-9-]{1,30}$/i.test(target)) throw new Error("Site ID should look like PH010010.");
        setResolving(true);
        siteId = target.toUpperCase();
        setSite(siteId);
        const r = await lookup({ data: { siteId } });
        setResolving(false);
        if (r.error || !r.ip) throw new Error(r.error ?? "No IP found");
        target = r.ip; resolvedNetwork = r.network; setNetwork(r.network);
      }
      if (!isRouterIp(target)) throw new Error("Please enter a Site ID or a private IP address.");
      setIp(target);
      const [ping, ...ports] = await Promise.all([testPing(target), ...BROWSER_PORTS.map((port) => browsePort(target, port))]);
      const captures = ports.filter((capture): capture is CaptureResult => capture !== null);
      if (ping || captures.length) {
        try {
          await saveSiteCheck({ siteId, ip: target, network: resolvedNetwork, ping, ports: captures });
          setHistoryKey((key) => key + 1);
        } catch { /* History is best-effort; a failed save never blocks the check. */ }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
      setResolving(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Remote access" title="Site Connectivity Check">
        {isAdmin && <Button asChild variant="outline" size="sm"><Link to="/helper"><Server className="h-4 w-4" />Helper setup</Link></Button>}
      </PageHeader>
      <div className="space-y-6">
        <form onSubmit={connect} className="flex flex-col gap-3 border-b pb-6 sm:flex-row">
          <Input aria-label="Site ID or private IP" maxLength={32} value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)} placeholder="Site ID (PH010010) or private IP (10.x.x.x)" className="font-mono" />
          <Button type="submit" disabled={busy || pingState === "loading" || !query.trim()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Activity className="h-4 w-4" />}{resolving ? "Finding IP…" : busy ? "Checking…" : "Check site"}</Button>
        </form>
        {error && <p className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
        {ip && (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {site && <Field label="Site ID" value={site} />}
            <Field label="Router IP" value={ip} />
            <Field label="Network" value={network ?? "—"} />
            <Field label="Accessible ports" value={`${BROWSER_PORTS.filter((port) => tiles[port].capture?.accessible).length} / ${BROWSER_PORTS.length}`} />
          </div>
        )}
        <section aria-label="Ping test results" className="space-y-4 border-y py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold"><Activity className="h-4 w-4 text-primary" />Ping test</h2>
            <Button variant="outline" size="sm" disabled={!ip || busy || pingState === "loading"} onClick={() => { if (ip) void testPing(ip); }}>
              {pingState === "loading" ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-4 w-4" />}Run ping
            </Button>
          </div>
          <div aria-live="polite">
            {pingResult ? <>
              <p className={`mb-4 text-sm font-semibold ${pingResult.reachable ? "text-primary" : "text-muted-foreground"}`}>{pingResult.reachable ? "Replies received" : "No ping replies"}</p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
                <Field label="Sent" value={String(pingResult.transmitted)} />
                <Field label="Received" value={String(pingResult.received)} />
                <Field label="Packet loss" value={`${pingResult.packetLoss}%`} />
                <Field label="Minimum" value={pingResult.minMs === null ? "—" : `${pingResult.minMs.toFixed(2)} ms`} />
                <Field label="Average" value={pingResult.avgMs === null ? "—" : `${pingResult.avgMs.toFixed(2)} ms`} />
                <Field label="Maximum" value={pingResult.maxMs === null ? "—" : `${pingResult.maxMs.toFixed(2)} ms`} />
              </div>
              {!pingResult.reachable && <p className="mt-4 text-sm text-muted-foreground">ICMP may be blocked; web ports may still be accessible.</p>}
            </> : <p className={`text-sm ${pingState === "error" ? "text-destructive" : "text-muted-foreground"}`}>{pingState === "loading" ? "Testing ping…" : pingState === "error" ? pingError : "Not tested"}</p>}
          </div>
        </section>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {BROWSER_PORTS.map((port) => {
            const tile = tiles[port];
            const url = ip ? routerUrl(ip, port) : null;
            return <article key={port} className="overflow-hidden rounded-lg border bg-card">
              <header className="flex items-center justify-between border-b px-4 py-3">
                <div><h2 className="font-semibold">Port {port}</h2><p className="font-mono text-xs text-muted-foreground">{portLabel(port)}</p></div>
                <span className={`text-xs ${tile.capture?.accessible ? "text-primary" : "text-muted-foreground"}`}>{tile.state === "loading" ? "Browsing" : tile.capture ? tile.capture.accessible ? "Accessible" : "Not accessible" : tile.state === "error" ? "Unavailable" : "Not browsed"}</span>
              </header>
              <div className="flex aspect-[4/3] items-center justify-center bg-muted/40">
                {tile.capture ? <a href={tile.capture.screenshot} download={`router-${ip}-port-${port}.jpg`} className="block h-full w-full" title={`Download port ${port} screenshot`}><img src={tile.capture.screenshot} alt={tile.capture.accessible ? `Router ${ip}, port ${port}` : `Not able to access Port ${port}`} className="h-full w-full object-contain" /></a> :
                  <div className="flex flex-col items-center gap-3 px-5 text-center text-sm text-muted-foreground">
                    {tile.state === "loading" ? <LoaderCircle className="h-7 w-7 animate-spin motion-reduce:animate-none" /> : <Camera className="h-7 w-7" />}
                    <p>{tile.state === "loading" ? `Browsing Port ${port}…` : tile.state === "error" ? tile.error : "Awaiting IP or Site ID"}</p>
                  </div>}
              </div>
              <footer className="flex min-h-14 items-center justify-between gap-2 border-t px-3 py-2">
                {url ? <Button asChild variant="ghost" size="sm"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Open</a></Button> : <span className="px-1 font-mono text-xs text-muted-foreground">—</span>}
                <div className="flex gap-1">
                  {tile.capture && <Button asChild variant="ghost" size="icon" title="Download screenshot"><a href={tile.capture.screenshot} download={`router-${ip}-port-${port}.jpg`} aria-label={`Download port ${port} screenshot`}><Download className="h-4 w-4" /></a></Button>}
                  <Button variant="ghost" size="icon" title="Browse port again" aria-label={`Retry port ${port}`} disabled={!ip || busy || tile.state === "loading"} onClick={() => { if (ip) void browsePort(ip, port); }}><RefreshCw className="h-4 w-4" /></Button>
                </div>
              </footer>
            </article>;
          })}
        </div>
        <CheckHistory siteId={site} ip={ip} refreshKey={historyKey} />
      </div>
    </>
  );
}

function CheckHistory({ siteId, ip, refreshKey }: { siteId: string | null; ip: string | null; refreshKey: number }) {
  const [checks, setChecks] = useState<SiteCheck[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!siteId && !ip) { setChecks(null); return; }
    let cancelled = false;
    listSiteChecks({ siteId, ip })
      .then((rows) => { if (!cancelled) { setChecks(rows); setLoadError(null); } })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load past checks."); });
    return () => { cancelled = true; };
  }, [siteId, ip, refreshKey]);

  if (!siteId && !ip) return null;
  return (
    <section aria-label="Past checks for this site" className="space-y-3 border-t pt-5">
      <h2 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-primary" />Past checks{siteId ? ` — ${siteId}` : ip ? ` — ${ip}` : ""}</h2>
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {checks === null && !loadError && <p className="text-sm text-muted-foreground">Loading…</p>}
      {checks?.length === 0 && <p className="text-sm text-muted-foreground">No saved checks yet. Run a check and it will appear here.</p>}
      <ul className="space-y-2">
        {checks?.map((check) => {
          const accessible = check.ports.filter((p) => p.accessible).length;
          const expanded = open === check.id;
          return (
            <li key={check.id} className="rounded-lg border bg-card">
              <button type="button" onClick={() => setOpen(expanded ? null : check.id)} aria-expanded={expanded} className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-left text-sm">
                <span className="font-mono text-muted-foreground">{new Date(check.created_at).toLocaleString()}</span>
                <span className="font-mono">{check.ip}</span>
                <span className={check.ping?.reachable ? "text-primary" : "text-muted-foreground"}>{check.ping ? (check.ping.reachable ? `Ping OK · ${check.ping.packetLoss}% loss` : "No ping replies") : "Ping not run"}</span>
                <span className="text-muted-foreground">Ports {accessible} / {check.ports.length || BROWSER_PORTS.length} accessible</span>
                <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded && (
                <div className="space-y-4 border-t px-4 py-4">
                  {check.ping && (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
                      <Field label="Sent" value={String(check.ping.transmitted)} />
                      <Field label="Received" value={String(check.ping.received)} />
                      <Field label="Packet loss" value={`${check.ping.packetLoss}%`} />
                      <Field label="Minimum" value={check.ping.minMs === null ? "—" : `${check.ping.minMs.toFixed(2)} ms`} />
                      <Field label="Average" value={check.ping.avgMs === null ? "—" : `${check.ping.avgMs.toFixed(2)} ms`} />
                      <Field label="Maximum" value={check.ping.maxMs === null ? "—" : `${check.ping.maxMs.toFixed(2)} ms`} />
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {check.ports.map((capture) => (
                      <figure key={capture.port} className="overflow-hidden rounded-md border">
                        <a href={capture.screenshot} download={`router-${check.ip}-port-${capture.port}-${check.created_at.slice(0, 10)}.jpg`} title={`Download port ${capture.port} screenshot`}>
                          <img src={capture.screenshot} alt={capture.accessible ? `Port ${capture.port} accessible` : `Not able to access Port ${capture.port}`} className="aspect-[4/3] w-full bg-muted/40 object-contain" />
                        </a>
                        <figcaption className="flex items-center justify-between px-3 py-2 text-xs">
                          <span className="font-mono">Port {capture.port}</span>
                          <span className={capture.accessible ? "text-primary" : "text-muted-foreground"}>{capture.accessible ? "Accessible" : "Not accessible"}</span>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono">{value}</p>
    </div>
  );
}
