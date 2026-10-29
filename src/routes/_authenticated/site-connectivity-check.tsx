import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ExternalLink, Camera, LoaderCircle, RefreshCw, Download } from "lucide-react";
import { lookupSite } from "@/lib/aeris.functions";
import { captureRouterPort } from "@/lib/site-connectivity.functions";
import { BROWSER_PORTS, isRouterIp, routerUrl, type BrowserPort, type CaptureResult } from "@/lib/site-connectivity";
import { PageHeader, meta } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/site-connectivity-check")({
  head: () => meta("Site Connectivity Check", "Resolve router Site IDs through Console Connect and check screenshots of ports 80, 443 and 8443."),
  component: SiteConnectivityCheck,
});

type Tile = { state: "idle" | "loading" | "done" | "error"; capture?: CaptureResult; error?: string };
const emptyTiles = (): Record<BrowserPort, Tile> => ({ 80: { state: "idle" }, 443: { state: "idle" }, 8443: { state: "idle" } });

function SiteConnectivityCheck() {
  const lookup = useServerFn(lookupSite);
  const capture = useServerFn(captureRouterPort);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ip, setIp] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [tiles, setTiles] = useState(emptyTiles);
  const [site, setSite] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  async function browsePort(target: string, port: BrowserPort) {
    setTiles((previous) => ({ ...previous, [port]: { state: "loading" } }));
    try {
      const result = await capture({ data: { ip: target, port } });
      setTiles((previous) => ({ ...previous, [port]: result.capture ? { state: "done", capture: result.capture } : { state: "error", error: result.error ?? "Screenshot unavailable" } }));
    } catch {
      setTiles((previous) => ({ ...previous, [port]: { state: "error", error: "Could not capture this port. Please try again." } }));
    }
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setIp(null); setNetwork(null); setSite(null); setTiles(emptyTiles());
    try {
      let target = query.trim();
      if (/^PH/i.test(target)) {
        if (!/^PH[A-Z0-9-]{1,30}$/i.test(target)) throw new Error("Site ID should look like PH010010.");
        setResolving(true);
        setSite(target.toUpperCase());
        const r = await lookup({ data: { siteId: target.toUpperCase() } });
        setResolving(false);
        if (r.error || !r.ip) throw new Error(r.error ?? "No IP found");
        target = r.ip; setNetwork(r.network);
      }
      if (!isRouterIp(target)) throw new Error("Please enter a Site ID or a private IP address.");
      setIp(target);
      await Promise.all(BROWSER_PORTS.map((port) => browsePort(target, port)));
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
        <Button asChild variant="outline" size="sm"><a href="/site-connectivity-service/service.zip" download><Download className="h-4 w-4" />Screenshot service</a></Button>
      </PageHeader>
      <div className="space-y-6">
        <form onSubmit={connect} className="flex flex-col gap-3 border-b pb-6 sm:flex-row">
          <Input aria-label="Site ID or private IP" maxLength={32} value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)} placeholder="Site ID (PH010010) or private IP (10.x.x.x)" className="font-mono" />
          <Button type="submit" disabled={busy || !query.trim()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Camera className="h-4 w-4" />}{resolving ? "Finding IP…" : busy ? "Browsing…" : "Browse"}</Button>
        </form>
        {error && <p className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
        {ip && (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {site && <Field label="Site ID" value={site} />}
            <Field label="Router IP" value={ip} />
            <Field label="Network" value={network ?? "—"} />
            <Field label="Accessible ports" value={`${BROWSER_PORTS.filter((port) => tiles[port].capture?.accessible).length} / 3`} />
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-3">
          {BROWSER_PORTS.map((port) => {
            const tile = tiles[port];
            const url = ip ? routerUrl(ip, port) : null;
            return <article key={port} className="overflow-hidden rounded-lg border bg-card">
              <header className="flex items-center justify-between border-b px-4 py-3">
                <div><h2 className="font-semibold">Port {port}</h2><p className="font-mono text-xs text-muted-foreground">{port === 80 ? "HTTP" : "HTTPS"}</p></div>
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
      </div>
    </>
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
