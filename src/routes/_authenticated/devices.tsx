import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Download, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { downloadCsv, isPrivateIp, runJob } from "@/lib/jobs";
import { PageHeader, meta } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => meta("Devices", "Add, edit and search site devices, pull their logs and export to CSV."),
  component: Devices,
});

type Device = Tables<"devices">;
const PAGE = 25;
const FIELDS = ["ip", "site_id", "name", "serial_number", "arm_version", "stm32_version", "web_version", "kernel_version", "mib_version"] as const;
type Form = Record<(typeof FIELDS)[number], string>;
const empty: Form = Object.fromEntries(FIELDS.map((f) => [f, ""])) as Form;
const LABELS: Record<string, string> = { ip: "IP address", site_id: "Site ID", name: "Brand / name", serial_number: "Serial number" };

function Devices() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<{ id: number | null; form: Form } | null>(null);
  const [deleting, setDeleting] = useState<Device | null>(null);
  const [pulling, setPulling] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ["devices", search, page],
    queryFn: async () => {
      let q = supabase.from("devices").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      const s = search.trim().replace(/[,()]/g, "");
      if (s) q = q.or(`ip.ilike.%${s}%,site_id.ilike.%${s}%,name.ilike.%${s}%,serial_number.ilike.%${s}%`);
      const { data, count } = await q;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  async function save() {
    if (!editing) return;
    const f = editing.form;
    if (!isPrivateIp(f.ip)) return toast.error("Enter a valid private IP address");
    const row = Object.fromEntries(FIELDS.map((k) => [k, f[k].trim() || null])) as Partial<Device> & { ip: string };
    const { error } = editing.id
      ? await supabase.from("devices").update({ ...row, updated_at: new Date().toISOString() }).eq("id", editing.id)
      : await supabase.from("devices").insert(row);
    if (error) return toast.error(error.code === "23505" ? "This IP or serial number already exists." : error.message);
    toast.success(editing.id ? "Device updated" : "Device created");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["devices"] });
  }

  async function remove() {
    if (!deleting) return;
    const { error } = await supabase.from("devices").delete().eq("id", deleting.id);
    if (error) toast.error(error.message); else toast.success("Device deleted");
    setDeleting(null);
    qc.invalidateQueries({ queryKey: ["devices"] });
  }

  async function pullLogs(d: Device) {
    setPulling(d.id);
    try {
      const j = await runJob("pull_logs", { ip: d.ip, site_id: d.site_id, brand: d.name ?? "enetek" }, { timeoutMs: 330_000 });
      if (j.status !== "done") throw new Error(j.error ?? "Log download failed");
      toast.success(`Imported ${(j.result as { imported: number }).imported} log lines`);
      qc.invalidateQueries({ queryKey: ["devices"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Log download failed");
    } finally {
      setPulling(null);
    }
  }

  async function exportAll(table: "devices" | "device_logs") {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from(table).select("*").order("id").range(from, from + 999);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    if (!rows.length) return toast.info("Nothing to export yet");
    downloadCsv(`${table}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  const pages = Math.max(1, Math.ceil((data?.count ?? 0) / PAGE));
  return (
    <>
      <PageHeader kicker="Inventory" title="Devices">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => exportAll("devices")}><Download className="h-4 w-4" />Devices CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => exportAll("device_logs")}><Download className="h-4 w-4" />Logs CSV</Button>
          <Button size="sm" onClick={() => setEditing({ id: null, form: empty })}><Plus className="h-4 w-4" />Add device</Button>
        </div>
      </PageHeader>
      <Input placeholder="Search IP, site ID, brand or serial…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="mb-4" />
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">{["IP", "Site ID", "Brand", "Serial", "Logs pulled", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {data?.rows.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-3 font-mono">{d.ip}</td>
                <td className="px-4 py-3 font-mono">{d.site_id ?? "—"}</td>
                <td className="px-4 py-3">{d.name ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs">{d.serial_number ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{d.last_log_pulled_at ? new Date(d.last_log_pulled_at).toLocaleString() : "Never"}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" title="Pull logs" disabled={pulling === d.id} onClick={() => pullLogs(d)}><RefreshCw className={`h-4 w-4 ${pulling === d.id ? "animate-spin" : ""}`} /></Button>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => setEditing({ id: d.id, form: Object.fromEntries(FIELDS.map((f) => [f, d[f] ?? ""])) as Form })}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleting(d)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </td>
              </tr>
            ))}
            {data && !data.rows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No devices found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>{data?.count ?? 0} devices</span>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>{page + 1} / {pages}</span>
          <Button variant="secondary" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit device" : "Add device"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f} className="space-y-1">
                <Label className="text-xs">{LABELS[f] ?? f.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase())}</Label>
                <Input className="font-mono" value={editing?.form[f] ?? ""} onChange={(e) => setEditing((s) => s && { ...s, form: { ...s.form, [f]: e.target.value } })} />
              </div>
            ))}
          </div>
          <DialogFooter><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete {deleting?.ip}?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={remove}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
