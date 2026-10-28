import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { Database, Users, RefreshCw, ShieldCheck, Loader2, KeyRound, Copy, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { checkDatabaseConnection, listSettingsUsers, getOktaSetup, checkOktaDomain, checkOktaSignIn } from "@/lib/admin-settings.functions";
import { setUserRole } from "@/lib/users.functions";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AdminSettings({ defaultTab = "database" }: { defaultTab?: "database" | "users" | "okta" }) {
  const { user } = useRouteContext({ from: "/_authenticated" });
  const qc = useQueryClient();
  const check = useServerFn(checkDatabaseConnection);
  const listUsers = useServerFn(listSettingsUsers);
  const setRole = useServerFn(setUserRole);
  const loadSetup = useServerFn(getOktaSetup);
  const testDomain = useServerFn(checkOktaDomain);
  const testSignIn = useServerFn(checkOktaSignIn);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [tab, setTab] = useState(defaultTab);
  const [oktaDomainInput, setOktaDomainInput] = useState("");
  const [domainResult, setDomainResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingDomain, setTestingDomain] = useState(false);
  const connection = useQuery({ queryKey: ["admin", "database"], queryFn: () => check(), retry: false });
  const accounts = useQuery({ queryKey: ["admin", "users"], queryFn: () => listUsers(), retry: false, enabled: tab === "users" });
  const setup = useQuery({ queryKey: ["admin", "okta", "setup"], queryFn: () => loadSetup(), retry: false, enabled: tab === "okta" });
  const signInStatus = useQuery({
    queryKey: ["admin", "okta", "signin"],
    queryFn: () => testSignIn(),
    retry: false,
    enabled: tab === "okta",
  });
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

  async function runDomainTest() {
    setTestingDomain(true);
    try {
      const result = await testDomain({ data: { domain: oktaDomainInput } });
      setDomainResult(
        result.ok
          ? { ok: true, text: `Reached ${result.domain} — issuer ${result.issuer}` }
          : { ok: false, text: result.error },
      );
    } catch (error) {
      setDomainResult({ ok: false, text: error instanceof Error ? error.message : "Test failed" });
    } finally {
      setTestingDomain(false);
    }
  }

  async function copyCallback() {
    if (!setup.data?.callbackUrl) return;
    try {
      await navigator.clipboard.writeText(setup.data.callbackUrl);
      toast.success("Redirect URI copied");
    } catch {
      toast.error("Couldn't copy — select the text manually.");
    }
  }

  return (
    <>
      <PageHeader kicker="Administration" title="Admin Settings">
        <span className="flex items-center gap-2 text-xs font-semibold text-primary"><ShieldCheck className="h-4 w-4" />Admins only</span>
      </PageHeader>
      <Tabs value={tab} onValueChange={(value) => { if (value === "database" || value === "users" || value === "okta") setTab(value); }}>
        <TabsList className="mb-8 h-auto w-full justify-start gap-2 overflow-x-auto rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="database" className="gap-2 whitespace-normal rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"><Database className="h-4 w-4 shrink-0" />Database Connection Settings</TabsTrigger>
          <TabsTrigger value="users" className="gap-2 whitespace-normal rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"><Users className="h-4 w-4 shrink-0" />User Settings</TabsTrigger>
          <TabsTrigger value="okta" className="gap-2 whitespace-normal rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"><KeyRound className="h-4 w-4 shrink-0" />Okta Integration</TabsTrigger>
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
        <TabsContent value="okta">
          <section className="max-w-3xl space-y-8">
            <div>
              <h2 className="text-xl font-semibold">Sign-in status</h2>
              <p className="mt-1 text-sm text-muted-foreground">Whether staff can currently sign in with the “Sign in with Okta” button.</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {signInStatus.isPending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking…</p>}
                {signInStatus.isError && <p role="alert" className="text-sm text-destructive">Couldn't check the sign-in status.</p>}
                {signInStatus.data && (
                  <p role="status" className={`flex items-center gap-2 text-sm font-semibold ${signInStatus.data.ready ? "text-primary" : "text-muted-foreground"}`}>
                    {signInStatus.data.ready ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {signInStatus.data.message}
                  </p>
                )}
                <Button variant="outline" onClick={() => signInStatus.refetch()} disabled={signInStatus.isFetching}><RefreshCw className={`h-4 w-4 ${signInStatus.isFetching ? "animate-spin" : ""}`} />Recheck</Button>
              </div>
            </div>
            <div>
              <h2 className="text-xl font-semibold">Connect Okta</h2>
              <ol className="mt-4 space-y-5 text-sm">
                <li>
                  <p className="font-semibold">1. Register the redirect URI in your Okta app</p>
                  <p className="mt-1 text-muted-foreground">In the Okta admin console, add this URI as an allowed redirect under your app's sign-in settings:</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded border bg-muted/50 px-3 py-2 font-mono text-xs">{setup.data?.callbackUrl ?? "Loading…"}</code>
                    <Button variant="outline" size="sm" onClick={copyCallback} disabled={!setup.data}><Copy className="h-4 w-4" />Copy</Button>
                  </div>
                </li>
                <li>
                  <p className="font-semibold">2. Turn on OIDC sign-in in the Lovable Cloud backend</p>
                  <p className="mt-1 text-muted-foreground">Open <span className="font-medium text-foreground">Users → Auth settings → OIDC</span>, switch OIDC sign-in on, then enter your Okta issuer URL (for example <code className="font-mono text-xs">https://yourcompany.okta.com</code>), the client ID from your Okta app, and the client secret. Save.</p>
                  <p className="mt-1 text-muted-foreground">For sign-in only (no profile sync), request the scopes <code className="font-mono text-xs">openid email profile</code>.</p>
                </li>
                <li>
                  <p className="font-semibold">3. Test the connection</p>
                  <p className="mt-1 text-muted-foreground">Enter your Okta domain to confirm the app server can reach it, then recheck the sign-in status above.</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input aria-label="Okta domain" placeholder="yourcompany.okta.com" value={oktaDomainInput} onChange={(event) => setOktaDomainInput(event.target.value)} className="w-full sm:w-72" />
                    <Button variant="outline" onClick={runDomainTest} disabled={testingDomain || oktaDomainInput.trim().length === 0}>{testingDomain ? "Testing…" : "Test Okta domain"}</Button>
                  </div>
                  {domainResult && (
                    <p role="status" className={`mt-2 flex items-start gap-2 text-sm ${domainResult.ok ? "text-primary" : "text-destructive"}`}>
                      {domainResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                      {domainResult.text}
                    </p>
                  )}
                </li>
              </ol>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}
