import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RefreshCw, Save, XCircle } from "lucide-react";
import { getConsoleSettings, saveConsoleSettings, testConsoleSettings } from "@/lib/console-connect.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = Awaited<ReturnType<typeof getConsoleSettings>>[number];

function ConnectionForm({ config }: { config: Settings }) {
  const qc = useQueryClient();
  const save = useServerFn(saveConsoleSettings);
  const test = useServerFn(testConsoleSettings);
  const [form, setForm] = useState({ tokenUrl: config.tokenUrl, apiUrl: config.apiUrl, clientId: config.clientId, username: config.username, password: "" });
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const lookup = config.integration === "site_lookup";
  const title = lookup ? "Site ID lookup" : "SIM activation";
  const fields = [
    ...(lookup ? [{ key: "tokenUrl" as const, label: "Token URL" }] : []),
    { key: "apiUrl" as const, label: "API base URL" },
    ...(lookup ? [{ key: "clientId" as const, label: "Client ID" }] : []),
    { key: "username" as const, label: "Username" },
    { key: "password" as const, label: "Password" },
  ];
  async function run(mode: "save" | "test") {
    setBusy(mode); setResult(null);
    try {
      if (mode === "save") {
        await save({ data: { ...form, integration: config.integration, password: form.password || undefined } });
        setForm((value) => ({ ...value, password: "" }));
        setResult({ ok: true, message: "Console Connect settings saved." });
        await qc.invalidateQueries({ queryKey: ["admin", "console-connect"] });
      } else setResult(await test({ data: config.integration }));
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : "Couldn't update the connection." });
    } finally { setBusy(null); }
  }
  return (
    <section aria-label={`${title} settings`} className="border-b pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        <span className={`flex items-center gap-2 text-sm ${config.ready ? "text-primary" : "text-muted-foreground"}`}>
          {config.ready ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{config.ready ? "Configured · not tested" : "Not configured"}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[160px_1fr]">
        <dt className="text-muted-foreground">Configuration source</dt><dd>{config.source}</dd>
        <dt className="text-muted-foreground">Authentication</dt><dd>{lookup ? "Password grant" : "Basic authentication"}</dd>
        <dt className="text-muted-foreground">Password status</dt><dd>{config.hasPassword ? "Stored securely" : "Not set"}</dd>
        {config.updatedAt && <><dt className="text-muted-foreground">Last saved</dt><dd>{new Date(config.updatedAt).toLocaleString()}</dd></>}
      </dl>
      <form onSubmit={(event) => { event.preventDefault(); void run("save"); }} className="mt-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(({ key, label }) => <div key={key} className={`space-y-2 ${key.endsWith("Url") ? "sm:col-span-2" : ""}`}>
            <Label htmlFor={`${config.integration}-${key}`}>{label}</Label>
            <Input id={`${config.integration}-${key}`} type={key === "password" ? "password" : key.endsWith("Url") ? "url" : "text"} required={key !== "password" || !config.hasPassword} autoComplete={key === "password" ? "new-password" : "off"} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} placeholder={key === "password" && config.hasPassword ? "Leave blank to keep saved password" : undefined} />
          </div>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy !== null}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save settings</Button>
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => run("test")}><RefreshCw className={`h-4 w-4 ${busy === "test" ? "animate-spin" : ""}`} />Test saved connection</Button>
        </div>
        {result && <p role="status" className={`flex items-start gap-2 text-sm ${result.ok ? "text-primary" : "text-destructive"}`}>{result.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}{result.message}</p>}
      </form>
    </section>
  );
}

export function ConsoleConnectSettings() {
  const load = useServerFn(getConsoleSettings);
  const settings = useQuery({ queryKey: ["admin", "console-connect"], queryFn: () => load(), retry: false });
  return <div className="max-w-3xl space-y-8">
    {settings.isPending && <p role="status" className="text-sm text-muted-foreground">Loading current Console Connect configuration…</p>}
    {settings.isError && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">Couldn't load Console Connect settings.<Button variant="outline" onClick={() => settings.refetch()}>Retry</Button></div>}
    {settings.data?.map((config) => <ConnectionForm key={config.integration} config={config} />)}
  </div>;
}