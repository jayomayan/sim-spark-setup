import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getSiteTargets, saveSiteTargets } from "@/lib/site-settings.functions";
import { siteTargetsSchema, type SiteTarget } from "@/lib/site-connectivity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Row = { port: string; protocol: SiteTarget["protocol"] };
export function SiteConnectivitySettings() {
  const load = useServerFn(getSiteTargets);
  const save = useServerFn(saveSiteTargets);
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["site-targets"], queryFn: () => load(), retry: false });
  const [draft, setDraft] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = draft ?? settings.data?.map((row) => ({ ...row, port: String(row.port) })) ?? [];
  function update(index: number, values: Partial<Row>) { setDraft(rows.map((row, i) => i === index ? { ...row, ...values } : row)); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = siteTargetsSchema.safeParse(rows.map((row) => ({ ...row, port: Number(row.port) })));
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Check the ports and protocols."); return; }
    setBusy(true);
    try {
      const saved = await save({ data: parsed.data });
      qc.setQueryData(["site-targets"], saved);
      setDraft(null);
      toast.success("Connectivity settings saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save settings."); }
    finally { setBusy(false); }
  }
  if (settings.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading connectivity settings…</p>;
  if (settings.isError) return <div role="alert" className="space-y-3 text-destructive">Could not load connectivity settings.<Button variant="outline" onClick={() => settings.refetch()}>Retry</Button></div>;
  return <form onSubmit={submit} className="max-w-2xl space-y-5">
    <h2 className="text-xl font-semibold">Site Connectivity Check</h2>
    <div className="divide-y border-y">
      {rows.map((row, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] items-end gap-3 py-3">
        <div className="space-y-1"><Label htmlFor={`site-port-${index}`}>Port</Label><Input id={`site-port-${index}`} type="number" min={1} max={65535} required value={row.port} disabled={busy} onChange={(e) => update(index, { port: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor={`site-protocol-${index}`}>Protocol</Label><Select value={row.protocol} disabled={busy} onValueChange={(value) => { if (value === "http" || value === "https") update(index, { protocol: value }); }}><SelectTrigger id={`site-protocol-${index}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="http">HTTP</SelectItem><SelectItem value="https">HTTPS</SelectItem></SelectContent></Select></div>
        <Button type="button" variant="ghost" size="icon" title="Remove check" aria-label={`Remove check ${index + 1}`} disabled={busy} onClick={() => setDraft(rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
      </div>)}
      {rows.length === 0 && <p className="py-4 text-sm text-muted-foreground">No web ports configured.</p>}
    </div>
    <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={busy || rows.length >= 20} onClick={() => setDraft([...rows, { port: "", protocol: "http" }])}><Plus className="h-4 w-4" />Add port</Button><Button type="submit" disabled={busy || draft === null}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save settings</Button></div>
  </form>;
}