import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { Database, Users, RefreshCw, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { checkDatabaseConnection, listSettingsUsers } from "@/lib/admin-settings.functions";
import { setUserRole } from "@/lib/users.functions";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AdminSettings({ defaultTab = "database" }: { defaultTab?: "database" | "users" }) {
  const { user } = useRouteContext({ from: "/_authenticated" });
  const qc = useQueryClient();
  const check = useServerFn(checkDatabaseConnection);
  const listUsers = useServerFn(listSettingsUsers);
  const setRole = useServerFn(setUserRole);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [tab, setTab] = useState(defaultTab);
  const connection = useQuery({ queryKey: ["admin", "database"], queryFn: () => check(), retry: false });
  const accounts = useQuery({ queryKey: ["admin", "users"], queryFn: () => listUsers(), retry: false, enabled: tab === "users" });
  const filtered = accounts.data?.filter((account) => `${account.email ?? ""} ${account.display_name ?? ""}`.toLowerCase().includes(search.toLowerCase())) ?? [];

  async function change(userId: string, role: string) {
    if (role !== "admin" && role !== "operator" && role !== "none") return;
    setSaving(userId);
    try {
      await setRole({ data: { userId, role } });
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success("User access updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update access");
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <PageHeader kicker="Administration" title="Admin Settings">
        <span className="flex items-center gap-2 text-xs font-semibold text-primary"><ShieldCheck className="h-4 w-4" />Admins only</span>
      </PageHeader>
      <Tabs value={tab} onValueChange={(value) => { if (value === "database" || value === "users") setTab(value); }}>
        <TabsList className="mb-8 h-auto w-full justify-start gap-2 overflow-x-auto rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="database" className="gap-2 whitespace-normal rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"><Database className="h-4 w-4 shrink-0" />Database Connection Settings</TabsTrigger>
          <TabsTrigger value="users" className="gap-2 whitespace-normal rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"><Users className="h-4 w-4 shrink-0" />User Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="database">
          <section>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">Current connection</h2>
              <Button variant="outline" onClick={() => connection.refetch()} disabled={connection.isFetching}><RefreshCw className={`h-4 w-4 ${connection.isFetching ? "animate-spin" : ""}`} />{connection.isFetching ? "Testing…" : "Test connection"}</Button>
            </div>
            {connection.isPending && <p role="status" className="text-sm text-muted-foreground">Checking connection…</p>}
            {connection.isError && <p role="alert" className="mb-4 text-sm text-destructive">Couldn't check the connection. Please try again.</p>}
            <dl className="divide-y border-y text-sm">
              {[
                ["Provider", "Lovable Cloud"],
                ["Database", "PostgreSQL"],
                ["Connection", "Managed connection"],
                ["Credentials", "Managed securely by Lovable Cloud"],
                ["Status", connection.data ? (connection.data.connected ? "Connected" : "Connection failed") : "Not checked"],
                ["Response time", connection.data ? `${connection.data.latencyMs} ms` : "—"],
                ["Last checked", connection.data ? new Date(connection.data.checkedAt).toLocaleString() : "—"],
              ].map(([label, value]) => <div key={label} className="grid grid-cols-1 gap-1 py-4 sm:grid-cols-[180px_1fr]"><dt className="text-muted-foreground">{label}</dt><dd className={label === "Status" ? "font-semibold text-primary" : "font-medium"}>{value}</dd></div>)}
            </dl>
          </section>
        </TabsContent>
        <TabsContent value="users">
          <section>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">User access <span className="ml-2 text-sm font-normal text-muted-foreground">{accounts.data?.length ?? 0} accounts</span></h2>
              <Input aria-label="Search users" placeholder="Search by name or email" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full sm:w-72" />
            </div>
            {accounts.isPending && <p role="status" className="text-sm text-muted-foreground">Loading users…</p>}
            {accounts.isError && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">Couldn't load users.<Button variant="outline" onClick={() => accounts.refetch()}>Retry</Button></div>}
            <div className="divide-y border-y">
              {filtered.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="min-w-0 flex-1 basis-48"><p className="break-words text-sm font-semibold">{account.email ?? "No email"}{account.id === user.id && <span className="ml-2 text-xs font-normal text-muted-foreground">You</span>}</p><p className="mt-1 break-words text-xs text-muted-foreground">{account.display_name || "—"}</p></div>
                <div className="flex items-center gap-2">
                  {saving === account.id && <Loader2 aria-label="Saving access" className="h-4 w-4 animate-spin text-primary" />}
                  <Select value={account.role} onValueChange={(value) => change(account.id, value)} disabled={saving !== null || account.id === user.id}>
                    <SelectTrigger aria-label={`Access for ${account.email ?? account.id}`} className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="operator">Non-Staff</SelectItem><SelectItem value="admin">Admin</SelectItem><SelectItem value="none">No access</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>)}
              {!accounts.isPending && !accounts.isError && filtered.length === 0 && <p className="py-8 text-sm text-muted-foreground">No users found.</p>}
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}