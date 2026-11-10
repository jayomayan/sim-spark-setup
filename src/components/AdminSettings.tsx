import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { Database, Users, RefreshCw, ShieldCheck, Loader2, KeyRound, Copy, CheckCircle2, XCircle, Server, Pencil, Trash2, Plus, Terminal } from "lucide-react";
import { toast } from "sonner";
import {
  checkDatabaseConnection,
  listSettingsUsers,
  getOktaSetup,
  checkOktaDomain,
  checkOktaSignIn,
  getOktaSettings,
  saveOktaSettings,
  testOktaConnection,
  listConnectionProfiles,
  saveConnectionProfile,
  deleteConnectionProfile,
  testConnectionProfile,
  setupConnectionProfile,
} from "@/lib/admin-settings.functions";
import { setUserRole } from "@/lib/users.functions";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConsoleConnectSettings } from "@/components/ConsoleConnectSettings";
import { HelperSettings } from "@/components/HelperSettings";
import { InviteExternalUser } from "@/components/InviteExternalUser";
import { InvitationHistory } from "@/components/InvitationHistory";
import { SiteConnectivitySettings } from "@/components/SiteConnectivitySettings";

type ProfileForm = { label: string; host: string; port: string; databaseName: string; username: string; password: string };

const EMPTY_FORM: ProfileForm = { label: "", host: "", port: "5432", databaseName: "postgres", username: "", password: "" };

export function AdminSettings({ defaultTab = "database" }: { defaultTab?: "database" | "users" | "okta" | "console-connect" | "helper" | "site-connectivity" }) {
  const { user } = useRouteContext({ from: "/_authenticated" });
  const qc = useQueryClient();
  const check = useServerFn(checkDatabaseConnection);
  const listUsers = useServerFn(listSettingsUsers);
  const setRole = useServerFn(setUserRole);
  const loadSetup = useServerFn(getOktaSetup);
  const testDomain = useServerFn(checkOktaDomain);
  const testSignIn = useServerFn(checkOktaSignIn);
  const loadOktaSettings = useServerFn(getOktaSettings);
  const saveOkta = useServerFn(saveOktaSettings);
  const testOkta = useServerFn(testOktaConnection);
  const listProfiles = useServerFn(listConnectionProfiles);
  const saveProfile = useServerFn(saveConnectionProfile);
  const removeProfile = useServerFn(deleteConnectionProfile);
  const testProfile = useServerFn(testConnectionProfile);
  const setupProfile = useServerFn(setupConnectionProfile);

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [tab, setTab] = useState(defaultTab);
  const [oktaDomainInput, setOktaDomainInput] = useState("");
  const [domainResult, setDomainResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingDomain, setTestingDomain] = useState(false);
  const [oktaForm, setOktaForm] = useState({ domain: "", clientId: "", clientSecret: "" });
  const [oktaBusy, setOktaBusy] = useState<"save" | "test" | null>(null);
  const [oktaResult, setOktaResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState<"save" | "test" | "delete" | "setup" | null>(null);
  const [settingUpId, setSettingUpId] = useState<string | null>(null);
  const [formResult, setFormResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [rowResults, setRowResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const connection = useQuery({ queryKey: ["admin", "database"], queryFn: () => check(), retry: false });
  const accounts = useQuery({ queryKey: ["admin", "users"], queryFn: () => listUsers(), retry: false, enabled: tab === "users" });
  const profiles = useQuery({ queryKey: ["admin", "dbprofiles"], queryFn: () => listProfiles(), retry: false, enabled: tab === "database" });
  const setup = useQuery({ queryKey: ["admin", "okta", "setup"], queryFn: () => loadSetup(), retry: false, enabled: tab === "okta" });
  const signInStatus = useQuery({
    queryKey: ["admin", "okta", "signin"],
    queryFn: () => testSignIn(),
    retry: false,
    enabled: tab === "okta",
  });
  const oktaSettings = useQuery({
    queryKey: ["admin", "okta", "settings"],
    queryFn: () => loadOktaSettings(),
    retry: false,
    enabled: tab === "okta",
  });
  useEffect(() => {
    if (oktaSettings.data) {
      setOktaForm((prev) => ({ ...prev, domain: oktaSettings.data.domain, clientId: oktaSettings.data.clientId }));
    }
  }, [oktaSettings.data]);
  const filtered = accounts.data?.filter((account) => `${account.username ?? ""} ${account.email ?? ""} ${account.display_name ?? ""}`.toLowerCase().includes(search.toLowerCase())) ?? [];

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

  function setField(field: keyof ProfileForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function editProfile(id: string) {
    const profile = profiles.data?.find((item) => item.id === id);
    if (!profile) return;
    setEditingId(id);
    setForm({ label: profile.label, host: profile.host, port: String(profile.port), databaseName: profile.databaseName, username: profile.username, password: "" });
    setFormResult(null);
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormResult(null);
  }

  async function submitProfile(mode: "save" | "test" | "setup") {
    if (!form.label.trim() || !form.host.trim() || !form.username.trim()) {
      setFormResult({ ok: false, text: "Label, host and username are required." });
      return;
    }
    const port = Number.parseInt(form.port || "5432", 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setFormResult({ ok: false, text: "Port must be a number between 1 and 65535." });
      return;
    }
    setFormBusy(mode);
    setFormResult(null);
    try {
      const payload = {
        id: editingId ?? undefined,
        label: form.label.trim(),
        host: form.host.trim(),
        port,
        databaseName: form.databaseName.trim() || "postgres",
        username: form.username.trim(),
        password: form.password.length > 0 ? form.password : undefined,
      };
      if (mode === "save" || mode === "setup") {
        const { id } = await saveProfile({ data: payload });
        await qc.invalidateQueries({ queryKey: ["admin", "dbprofiles"] });
        setEditingId(id);
        setForm((current) => ({ ...current, password: "" }));
        if (mode === "setup") {
          const result = await setupProfile({ data: { id } });
          setFormResult({ ok: result.ok, text: result.message });
          setRowResults((current) => ({ ...current, [id]: { ok: result.ok, text: result.message } }));
          if (result.ok) toast.success("Database ready");
        } else {
          setFormResult({ ok: true, text: "Connection saved." });
          toast.success("Connection profile saved");
        }
      } else {
        const usesSavedPassword = Boolean(editingId) && form.password.length === 0;
        const result = usesSavedPassword && editingId
          ? await testProfile({ data: { id: editingId } })
          : await testProfile({ data: { connection: payload } });
        setFormResult({ ok: result.ok, text: result.ok ? `Connected — ${result.message} (${result.latencyMs} ms)` : result.message });
      }
    } catch (error) {
      setFormResult({ ok: false, text: error instanceof Error ? error.message : "Something went wrong" });
    } finally {
      setFormBusy(null);
    }
  }

  async function testSavedRow(id: string) {
    setRowResults((current) => ({ ...current, [id]: { ok: true, text: "Testing…" } }));
    try {
      const result = await testProfile({ data: { id } });
      setRowResults((current) => ({
        ...current,
        [id]: { ok: result.ok, text: result.ok ? `Connected — ${result.message} (${result.latencyMs} ms)` : result.message },
      }));
    } catch (error) {
      setRowResults((current) => ({ ...current, [id]: { ok: false, text: error instanceof Error ? error.message : "Test failed" } }));
    }
  }

  async function setupSavedRow(id: string) {
    setSettingUpId(id);
    setRowResults((current) => ({ ...current, [id]: { ok: true, text: "Connecting and setting up database…" } }));
    try {
      const result = await setupProfile({ data: { id } });
      setRowResults((current) => ({ ...current, [id]: { ok: result.ok, text: result.message } }));
    } catch {
      setRowResults((current) => ({ ...current, [id]: { ok: false, text: "Couldn't set up this database. Please retry." } }));
    } finally {
      setSettingUpId(null);
    }
  }

  async function deleteProfile(id: string) {
    setFormBusy("delete");
    try {
      await removeProfile({ data: { id } });
      if (editingId === id) resetForm();
      await qc.invalidateQueries({ queryKey: ["admin", "dbprofiles"] });
      toast.success("Connection removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete");
    } finally {
      setFormBusy(null);
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

  const oktaFormValid = oktaForm.domain.trim().length > 0 && oktaForm.clientId.trim().length > 0;

  async function saveOktaForm() {
    setOktaBusy("save");
    setOktaResult(null);
    try {
      await saveOkta({ data: { domain: oktaForm.domain, clientId: oktaForm.clientId, clientSecret: oktaForm.clientSecret || undefined } });
      setOktaForm((prev) => ({ ...prev, clientSecret: "" }));
      await qc.invalidateQueries({ queryKey: ["admin", "okta", "settings"] });
      toast.success("Okta settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save");
    } finally {
      setOktaBusy(null);
    }
  }

  async function testOktaForm() {
    setOktaBusy("test");
    setOktaResult(null);
    try {
      const result = await testOkta({ data: { domain: oktaForm.domain, clientId: oktaForm.clientId, clientSecret: oktaForm.clientSecret || undefined } });
      setOktaResult({ ok: result.ok, text: result.message });
    } catch (error) {
      setOktaResult({ ok: false, text: error instanceof Error ? error.message : "Test failed" });
    } finally {
      setOktaBusy(null);
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
      <Tabs value={tab} onValueChange={(value) => { if (value === "database" || value === "users" || value === "okta" || value === "console-connect" || value === "helper" || value === "site-connectivity") setTab(value); }}>
        <TabsList className="mb-8 h-auto w-full justify-start gap-2 overflow-x-auto rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="database" className="gap-2 whitespace-normal rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"><Database className="h-4 w-4 shrink-0" />Database Connection Settings</TabsTrigger>
          <TabsTrigger value="users" className="gap-2 whitespace-normal rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"><Users className="h-4 w-4 shrink-0" />User Settings</TabsTrigger>
          <TabsTrigger value="okta" className="gap-2 whitespace-normal rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"><KeyRound className="h-4 w-4 shrink-0" />Okta Integration</TabsTrigger>
          <TabsTrigger value="console-connect" className="gap-2 whitespace-normal rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"><Server className="h-4 w-4 shrink-0" />Console Connect</TabsTrigger>
          <TabsTrigger value="helper" className="gap-2 whitespace-normal rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"><Terminal className="h-4 w-4 shrink-0" />Network Helper</TabsTrigger>
        </TabsList>
        <TabsList className="mb-6"><TabsTrigger value="site-connectivity">Site Connectivity Check</TabsTrigger></TabsList>
        <TabsContent value="site-connectivity"><SiteConnectivitySettings /></TabsContent>
        <TabsContent value="console-connect"><ConsoleConnectSettings /></TabsContent>
        <TabsContent value="helper"><HelperSettings /></TabsContent>
        <TabsContent value="database">
          <div className="max-w-3xl space-y-10">
            <section>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold">Current connection</h2>
                <Button variant="outline" onClick={() => connection.refetch()} disabled={connection.isFetching}><RefreshCw className={`h-4 w-4 ${connection.isFetching ? "animate-spin" : ""}`} />{connection.isFetching ? "Testing…" : "Test connection"}</Button>
              </div>
              {connection.isPending && <p role="status" className="text-sm text-muted-foreground">Checking connection…</p>}
              {connection.isError && <p role="alert" className="mb-4 text-sm text-destructive">Couldn't check the connection. Please try again.</p>}
              <dl className="divide-y border-y text-sm">
                {[
                  ["Provider", "Application backend"],
                  ["Database", "PostgreSQL"],
                  ["Connection", "Primary connection"],
                  ["Credentials", "Stored securely on the server"],
                  ["Status", connection.data ? (connection.data.connected ? "Connected" : "Connection failed") : "Not checked"],
                  ["Response time", connection.data ? `${connection.data.latencyMs} ms` : "—"],
                  ["Last checked", connection.data ? new Date(connection.data.checkedAt).toLocaleString() : "—"],
                ].map(([label, value]) => <div key={label} className="grid grid-cols-1 gap-1 py-4 sm:grid-cols-[180px_1fr]"><dt className="text-muted-foreground">{label}</dt><dd className={label === "Status" ? "font-semibold text-primary" : "font-medium"}>{value}</dd></div>)}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">The app's own data always runs on this primary connection. Save profiles below to keep other servers ready for tests and migrations.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">Connection profiles</h2>
              <p className="mt-1 text-sm text-muted-foreground">Details for other database servers you may want to point tools at. Passwords are stored encrypted and never shown again.</p>
              <div className="divide-y border-y">
                {(profiles.data ?? []).map((profile) => (
                  <div key={profile.id} className="py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 basis-64">
                        <p className="flex items-center gap-2 text-sm font-semibold"><Server className="h-4 w-4 shrink-0 text-primary" />{profile.label}</p>
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{profile.host}:{profile.port}/{profile.databaseName} · {profile.username} · {profile.hasPassword ? "password saved" : "no password"}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setupSavedRow(profile.id)} disabled={settingUpId !== null || formBusy !== null}><Database className="h-4 w-4" />{settingUpId === profile.id ? "Setting up…" : "Connect & set up"}</Button>
                        <Button variant="outline" size="sm" onClick={() => testSavedRow(profile.id)} disabled={settingUpId !== null}>Test</Button>
                        <Button variant="outline" size="sm" onClick={() => editProfile(profile.id)}><Pencil className="h-4 w-4" />Edit</Button>
                        <Button variant="outline" size="sm" onClick={() => deleteProfile(profile.id)} disabled={formBusy !== null || settingUpId !== null}><Trash2 className="h-4 w-4" />Delete</Button>
                      </div>
                    </div>
                    {(() => {
                      const rowResult = rowResults[profile.id];
                      if (!rowResult) return null;
                      return (
                        <p role="status" className={`mt-2 flex items-start gap-2 text-sm ${rowResult.ok ? "text-primary" : "text-destructive"}`}>
                          {rowResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                          {rowResult.text}
                        </p>
                      );
                    })()}
                  </div>
                ))}
                {profiles.isPending && <p role="status" className="py-4 text-sm text-muted-foreground">Loading saved connections…</p>}
                {profiles.isError && <p role="alert" className="py-4 text-sm text-destructive">Couldn't load saved connections.</p>}
                {!profiles.isPending && !profiles.isError && (profiles.data ?? []).length === 0 && <p className="py-4 text-sm text-muted-foreground">No saved connections yet.</p>}
              </div>

              <div className="mt-6 rounded-lg border p-5">
                <h3 className="flex items-center gap-2 font-semibold"><Plus className="h-4 w-4 text-primary" />{editingId ? "Edit connection" : "Add connection"}</h3>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="db-label">Label</Label><Input id="db-label" placeholder="Old server" value={form.label} onChange={(e) => setField("label", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="db-host">Host</Label><Input id="db-host" placeholder="db.example.com" value={form.host} onChange={(e) => setField("host", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="db-port">Port</Label><Input id="db-port" inputMode="numeric" value={form.port} onChange={(e) => setField("port", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="db-name">Database name</Label><Input id="db-name" value={form.databaseName} onChange={(e) => setField("databaseName", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="db-user">Username</Label><Input id="db-user" autoComplete="off" value={form.username} onChange={(e) => setField("username", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="db-pass">Password{editingId ? <span className="ml-1 font-normal text-muted-foreground">(leave blank to keep saved)</span> : ""}</Label><Input id="db-pass" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setField("password", e.target.value)} /></div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button onClick={() => submitProfile("setup")} disabled={formBusy !== null || settingUpId !== null}>{formBusy === "setup" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}{formBusy === "setup" ? "Setting up…" : "Save, connect & set up"}</Button>
                  <Button variant="outline" onClick={() => submitProfile("save")} disabled={formBusy !== null}>{formBusy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{editingId ? "Save changes only" : "Save only"}</Button>
                  <Button variant="outline" onClick={() => submitProfile("test")} disabled={formBusy !== null}>{formBusy === "test" ? "Testing…" : "Test connection"}</Button>
                  {editingId && <Button variant="ghost" onClick={resetForm}>Cancel editing</Button>}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Setup creates a missing database and the required tables in the field_ops schema. The account needs database and table creation permissions. Existing data and sign-in stay unchanged; setup does not move data or switch the app's current connection.</p>
                {formResult && (
                  <p role="status" className={`mt-3 flex items-start gap-2 text-sm ${formResult.ok ? "text-primary" : "text-destructive"}`}>
                    {formResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                    {formResult.text}
                  </p>
                )}
              </div>
            </section>
          </div>
        </TabsContent>
        <TabsContent value="users">
          <section>
            <InviteExternalUser />
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">User access <span className="ml-2 text-sm font-normal text-muted-foreground">{accounts.data?.length ?? 0} accounts</span></h2>
              <Input aria-label="Search users" placeholder="Search by name or email" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full sm:w-72" />
            </div>
            {accounts.isPending && <p role="status" className="text-sm text-muted-foreground">Loading users…</p>}
            {accounts.isError && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">Couldn't load users.<Button variant="outline" onClick={() => accounts.refetch()}>Retry</Button></div>}
            <div className="divide-y border-y">
              {filtered.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="min-w-0 flex-1 basis-48"><p className="break-words text-sm font-semibold">{account.username ?? account.email ?? "No email"}{account.id === user.id && <span className="ml-2 text-xs font-normal text-muted-foreground">You</span>}</p><p className="mt-1 break-words text-xs text-muted-foreground">{account.display_name || "—"} {account.username && account.email ? `· ${account.email}` : ""} {account.phone ? `· ${account.phone}` : ""}</p></div>
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
            <InvitationHistory />
          </section>
        </TabsContent>
        <TabsContent value="okta">
          <section className="max-w-3xl space-y-8">
            <div>
              <h2 className="text-xl font-semibold">Okta connection parameters</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your Okta app's details, stored encrypted. The client secret is never shown after saving — leave it blank to keep the saved one.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="okta-domain">Base URL</Label>
                  <Input id="okta-domain" placeholder="yourcompany.okta.com" value={oktaForm.domain}
                    onChange={(event) => setOktaForm((prev) => ({ ...prev, domain: event.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="okta-client-id">Client ID</Label>
                  <Input id="okta-client-id" placeholder="0oa…" value={oktaForm.clientId}
                    onChange={(event) => setOktaForm((prev) => ({ ...prev, clientId: event.target.value }))} className="mt-1 font-mono text-sm" />
                </div>
                <div>
                  <Label htmlFor="okta-client-secret">Client secret</Label>
                  <Input id="okta-client-secret" type="password" placeholder={oktaSettings.data?.hasSecret ? "••••••••  (saved)" : "Client secret"}
                    value={oktaForm.clientSecret}
                    onChange={(event) => setOktaForm((prev) => ({ ...prev, clientSecret: event.target.value }))} className="mt-1 font-mono text-sm" />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={testOktaForm} disabled={oktaBusy !== null || !oktaFormValid}>
                  {oktaBusy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {oktaBusy === "test" ? "Testing…" : "Test connection"}
                </Button>
                <Button onClick={saveOktaForm} disabled={oktaBusy !== null || !oktaFormValid}>
                  {oktaBusy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {oktaBusy === "save" ? "Saving…" : "Save settings"}
                </Button>
                {oktaSettings.data?.updatedAt && (
                  <span className="text-xs text-muted-foreground">Saved {new Date(oktaSettings.data.updatedAt).toLocaleString()}</span>
                )}
              </div>
              {oktaResult && (
                <p role="status" className={`mt-3 flex items-start gap-2 text-sm ${oktaResult.ok ? "text-primary" : "text-destructive"}`}>
                  {oktaResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                  {oktaResult.text}
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                These saved values are a reference for your team. For the “Sign in with Okta” button itself, the same values must also be entered once in the backend under <span className="font-medium text-foreground">Users → Auth settings → OIDC</span> (step 2 below) — the app isn't allowed to write that configuration itself.
              </p>
            </div>
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
                  <p className="font-semibold">2. Turn on OIDC sign-in in your authentication service</p>
                  <p className="mt-1 text-muted-foreground">Configure the OIDC provider with your Okta issuer URL (for example <code className="font-mono text-xs">https://yourcompany.okta.com</code>), client ID and client secret. For a standalone installation, follow the deployment guide's Okta setup instructions.</p>
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
