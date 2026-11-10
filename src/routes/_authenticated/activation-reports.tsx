import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { listActivationReports } from "@/lib/activation-reports.functions";
import { ACTIVATION_REPORT_PAGE_SIZE } from "@/lib/activation-reports";
import { PageHeader, meta } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const reportsQuery = (userId: string, page: number, search: string) => queryOptions({
  queryKey: ["admin", "activation-reports", userId, page, search],
  queryFn: () => listActivationReports({ data: { page, search } }),
  staleTime: 0,
});

export const Route = createFileRoute("/_authenticated/activation-reports")({
  validateSearch: (search: Record<string, unknown>) => {
    const page = Number(search['page'] ?? 0);
    const q = typeof search['q'] === "string" ? search['q'].slice(0, 100) : "";
    return { page: Number.isInteger(page) && page >= 0 && page <= 1000000 ? page : 0, q };
  },
  loaderDeps: ({ search }) => ({ page: search.page, q: search.q }),
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/dashboard" });
  },
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(reportsQuery(context.user.id, deps.page, deps.q)),
  head: () => meta("Activation Reports", "Admin-only SIM activation reports across all users for Frontier Tower Associates Philippines."),
  pendingComponent: () => <p role="status" className="text-sm text-muted-foreground">Loading activation reports…</p>,
  errorComponent: ReportError,
  notFoundComponent: () => <p>No activation report found.</p>,
  component: ActivationReports,
});

const equipmentLabels: Record<string, string> = { ur35: "Router", gps_battery: "GPS-Battery", gps_genset: "GPS-Genset", other: "Other" };
const statusLabels: Record<string, string> = { complete: "Complete", failed: "Failed", waiting_ip: "Waiting for IP", running: "In progress" };
const date = (value: string) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

function ReportError() {
  const router = useRouter();
  return <div role="alert" className="space-y-3"><p className="text-sm text-destructive">Couldn't load activation reports.</p><Button variant="outline" onClick={() => router.invalidate()}><RefreshCw />Retry</Button></div>;
}

function ActivationReports() {
  const { user } = Route.useRouteContext();
  const { page, q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [term, setTerm] = useState(q);
  const reports = useSuspenseQuery(reportsQuery(user.id, page, q));
  const { rows, total } = reports.data;
  const pageCount = Math.max(1, Math.ceil(total / ACTIVATION_REPORT_PAGE_SIZE));
  const applySearch = (value: string) => navigate({ search: { page: 0, q: value.trim() } });
  return <>
    <PageHeader kicker="Admin · SIM" title="Activation Reports">
      <Button variant="outline" size="sm" disabled={reports.isFetching} onClick={() => reports.refetch()}><RefreshCw className={reports.isFetching ? "animate-spin" : ""} />Refresh</Button>
    </PageHeader>
    <form className="mb-3 flex max-w-md gap-2" role="search" onSubmit={(event) => { event.preventDefault(); applySearch(term); }}>
      <Input type="search" aria-label="Search activation reports" placeholder="Search ICCID, Site ID or IP address…" value={term} onChange={(event) => setTerm(event.target.value)} />
      {q && <Button type="button" variant="outline" size="icon" aria-label="Clear search" onClick={() => { setTerm(""); applySearch(""); }}><X /></Button>}
      <Button type="submit" variant="outline" size="icon" aria-label="Search activation reports" disabled={reports.isFetching}><Search /></Button>
    </form>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <p>{total.toLocaleString()} {q ? `matching “${q}”` : "activations"} · All users</p><span>Times in Manila</span>
    </div>
    {reports.isRefetchError && <p role="alert" className="mb-3 text-sm text-destructive">Couldn't refresh reports. Showing the last loaded results.</p>}
    <div className="hidden overflow-x-auto border-y md:block">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/40 text-muted-foreground"><tr>{["Date / User", "ICCID / Site ID", "Equipment", "IP address", "Result"].map((heading) => <th key={heading} className="px-3 py-3 font-semibold">{heading}</th>)}</tr></thead>
        <tbody className="divide-y">{rows.map((row) => <tr key={row.id}>
          <td className="px-3 py-3 align-top"><time dateTime={row.created_at}>{date(row.created_at)}</time><p className="mt-1 max-w-44 break-words text-muted-foreground">{row.activated_by}</p></td>
          <td className="px-3 py-3 align-top"><p className="font-mono">{row.iccid}</p><p className="mt-1 text-muted-foreground">{row.site_id || "—"}</p></td>
          <td className="px-3 py-3 align-top">{row.equipment.map((key) => equipmentLabels[key] ?? key).join(", ") || "—"}</td>
          <td className="whitespace-nowrap px-3 py-3 align-top font-mono">{row.ip || "—"}</td>
          <td className="max-w-56 px-3 py-3 align-top"><p className={row.status === "failed" ? "text-destructive" : row.status === "complete" ? "text-primary" : "text-muted-foreground"}>{statusLabels[row.status] ?? row.status}{row.simulated ? " · Test mode" : ""}</p>{row.finished_at && <time className="mt-1 block text-muted-foreground" dateTime={row.finished_at}>{date(row.finished_at)}</time>}{row.error && <p className="mt-1 break-words text-destructive">{row.error}</p>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="divide-y border-y md:hidden">{rows.map((row) => <article key={row.id} className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><p className="break-all font-mono text-xs">{row.iccid}</p><span className={row.status === "failed" ? "text-destructive" : "text-primary"}>{statusLabels[row.status] ?? row.status}</span></div>
      <p className="break-words">{row.site_id || "—"} · {row.equipment.map((key) => equipmentLabels[key] ?? key).join(", ") || "—"}</p>
      <p className="font-mono text-xs">{row.ip || "No IP address"}{row.simulated ? " · Test mode" : ""}</p>
      <p className="break-words text-xs text-muted-foreground">{row.activated_by} · <time dateTime={row.created_at}>{date(row.created_at)}</time></p>
      {row.finished_at && <p className="text-xs text-muted-foreground">Finished: <time dateTime={row.finished_at}>{date(row.finished_at)}</time></p>}
      {row.error && <p className="break-words text-xs text-destructive">{row.error}</p>}
    </article>)}</div>
    {rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{total === 0 ? "No activations recorded yet." : "No activations on this page."}</p>}
    <div className="mt-4 flex items-center justify-end gap-3">
      <Button variant="outline" size="icon" aria-label="Previous activation reports" disabled={page === 0 || reports.isFetching} onClick={() => navigate({ search: { page: page - 1 } })}><ChevronLeft /></Button>
      <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
      <Button variant="outline" size="icon" aria-label="Next activation reports" disabled={page + 1 >= pageCount || reports.isFetching} onClick={() => navigate({ search: { page: page + 1 } })}><ChevronRight /></Button>
    </div>
  </>;
}