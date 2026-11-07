import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { listInvitationHistory } from "@/lib/users.functions";
import { Button } from "@/components/ui/button";

const statuses = { started: "Outcome pending", created: "Account created", failed: "Invitation failed", setup_failed: "Account setup failed" };
export function InvitationHistory() {
  const [page, setPage] = useState(0);
  const list = useServerFn(listInvitationHistory);
  const history = useQuery({ queryKey: ["admin", "invitation-history", page], queryFn: () => list({ data: { page } }), retry: false });
  return <section className="mt-10 border-t pt-8">
    <div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Invitation history</h2><Button variant="outline" size="sm" onClick={() => history.refetch()} disabled={history.isFetching}><RefreshCw className="h-4 w-4" />Refresh</Button></div>
    {history.isPending && <p role="status" className="text-sm text-muted-foreground">Loading invitations…</p>}
    {history.isError && <p role="alert" className="text-sm text-destructive">Couldn't load invitation history.</p>}
    <div className="divide-y border-y">
      {history.data?.rows.map((row) => <article key={row.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_1fr_auto]">
        <div className="min-w-0"><p className="break-words font-semibold">{row.username}</p><p className="mt-1 break-words text-xs text-muted-foreground">{row.display_name} · {row.phone}</p>{row.email && <p className="mt-1 break-all text-xs text-muted-foreground">{row.email}</p>}</div>
        <div className="min-w-0 text-sm"><p className="break-words">Invited by {row.admin_name}</p><time className="mt-1 block text-xs text-muted-foreground" dateTime={row.created_at}>{new Date(row.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })} Manila</time></div>
        <div className="text-sm"><p className={row.status === "created" ? "text-foreground" : row.status === "started" ? "text-warning" : "text-destructive"}>{statuses[row.status as keyof typeof statuses] ?? row.status}</p><p className="mt-1 text-xs text-muted-foreground">{row.email_status === "not_sent" ? "Email not sent" : "No email requested"}</p></div>
      </article>)}
      {history.data?.rows.length === 0 && <p className="py-6 text-sm text-muted-foreground">No invitations recorded yet.</p>}
    </div>
    {history.data && history.data.total > 20 && <div className="mt-4 flex items-center justify-end gap-3"><Button variant="outline" size="icon" aria-label="Previous invitations" disabled={page === 0 || history.isFetching} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button><span className="text-xs text-muted-foreground">Page {page + 1} of {Math.ceil(history.data.total / 20)}</span><Button variant="outline" size="icon" aria-label="Next invitations" disabled={(page + 1) * 20 >= history.data.total || history.isFetching} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button></div>}
  </section>;
}