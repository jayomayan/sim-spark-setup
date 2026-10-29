import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, KeyRound, Loader2, Plus, RefreshCw, Save, Terminal, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { createHelperInstallCode, getHelperSettings, rotateHelperKey, saveHelperSettings } from "@/lib/helper.functions";
import { buildInstallCommand, ENROLLMENT_TTL_MINUTES, type RouterLogin } from "@/lib/helper-settings";
import { HELPER_VERSION } from "@/lib/helper-release";
import { useHelperStatus } from "@/components/HelperStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Settings = Awaited<ReturnType<typeof getHelperSettings>>;
type Form = {
  routerLogins: RouterLogin[];
  firewallCommands: string;
  ntpCommands: string;
};

const toForm = (s: Settings): Form => ({
  routerLogins: s.routerLogins.map(({ id, username }) => ({ id, username, password: "" })),
  firewallCommands: s.firewallRules.map((rule) => rule.rule).join("\n"),
  ntpCommands: JSON.stringify(s.ntp, null, 2),
});

function InstallPanel() {
  const make = useServerFn(createHelperInstallCode);
  const reset = useServerFn(rotateHelperKey);
  const [command, setCommand] = useState<{ text: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<"make" | "reset" | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-console.lovable.app";

  async function generate() {
    setBusy("make");
    try {
      const { code, expiresAt } = await make();
      setCommand({ text: buildInstallCommand(origin, code), expiresAt });
    } catch {
      toast.error("Couldn't create an install command.");
    } finally {
      setBusy(null);
    }
  }

  async function resetKey() {
    setBusy("reset");
    try {
      await reset();
      setCommand(null);
      toast.success("Helper key reset. Every installed machine needs a new install command.");
    } catch {
      toast.error("Couldn't reset the helper key.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel space-y-4 p-6">
      <div className="flex items-start gap-3">
        <Terminal className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h3 className="font-semibold">Install on a Linux machine</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            One command downloads the helper, installs what it needs, saves the key and starts it as a service.
            The code works once and expires after {ENROLLMENT_TTL_MINUTES} minutes.
          </p>
        </div>
      </div>
      {command ? (
        <div className="space-y-3">
          <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs leading-relaxed">{command.text}</pre>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(command.text);
                toast.success("Install command copied.");
              }}
            >
              <Copy className="h-4 w-4" />Copy command
            </Button>
            <span className="text-xs text-muted-foreground">
              Expires {new Date(command.expiresAt).toLocaleTimeString()} · paste it on the machine over SSH
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No install command generated yet.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={generate} disabled={busy !== null}>
          {busy === "make" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
          {command ? "New install command" : "Create install command"}
        </Button>
        <Button variant="outline" onClick={resetKey} disabled={busy !== null}>
          {busy === "reset" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Reset helper key
        </Button>
      </div>
    </section>
  );
}

export function HelperSettings() {
  const qc = useQueryClient();
  const load = useServerFn(getHelperSettings);
  const save = useServerFn(saveHelperSettings);
  const { data: helper } = useHelperStatus();
  const settings = useQuery({ queryKey: ["admin", "helper"], queryFn: () => load(), retry: false });
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  const current = settings.data;
  // Re-fill the form whenever the stored revision changes (a save, or an explicit reload),
  // so the password box goes back to "leave blank to keep the saved one".
  useEffect(() => {
    if (current) setForm(toForm(current));
  }, [current?.configVersion]);
  if (!form) {
    return (
      <div className="max-w-3xl space-y-6">
        {settings.isPending && <p role="status" className="text-sm text-muted-foreground">Loading helper settings…</p>}
        {settings.isError && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            Couldn't load helper settings.<Button variant="outline" onClick={() => settings.refetch()}>Retry</Button>
          </div>
        )}
      </div>
    );
  }

  const setField = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  async function submit() {
    setSaving(true);
    try {
      if (!form) return;
      const { firewallCommands, ntpCommands, ...fields } = form;
      let ntp: unknown;
      try { ntp = JSON.parse(ntpCommands); } catch { throw new Error("NTP commands must be valid JSON."); }
      if (!ntp || typeof ntp !== "object" || !("enabled" in ntp) || typeof ntp.enabled !== "boolean" ||
          !("servers" in ntp) || !Array.isArray(ntp.servers) || !ntp.servers.every((server) => typeof server === "string") ||
          !("timezone" in ntp) || typeof ntp.timezone !== "string") {
        throw new Error("NTP commands need enabled, servers and timezone values.");
      }
      const firewallRules = firewallCommands.split(/\r?\n/).map((rule) => rule.trim()).filter(Boolean).map((rule) => ({
        rule,
        description: current?.firewallRules.find((saved) => saved.rule === rule)?.description ?? "",
      }));
      await save({ data: {
        ...fields, firewallRules,
        ur35FirewallPath: current?.ur35FirewallPath ?? "/api/firewall/rules",
        ur35NtpPath: current?.ur35NtpPath ?? "/api/system/ntp",
        ntpEnabled: ntp.enabled, ntpServers: ntp.servers.join(", "), ntpTimezone: ntp.timezone,
      } });
      setForm((f) => (f ? { ...f, routerLogins: f.routerLogins.map((login) => ({ ...login, password: "" })) } : f));
      toast.success("Saved — the helper picks the changes up within a minute.");
      await qc.invalidateQueries({ queryKey: ["admin", "helper"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save helper settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <InstallPanel />

      <section className="panel space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Router login and templates</h3>
          <span className={`flex items-center gap-2 text-sm ${helper?.online ? "text-primary" : "text-muted-foreground"}`}>
            {helper?.online ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {helper?.online ? `Helper online · v${helper.version ?? "?"}` : "Helper offline"}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Sent to the connected helper over an encrypted link — never shown in the browser again.
          The console serves release v{HELPER_VERSION}; installed helpers move to it on their own.
        </p>

        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-medium">Router logins</h4>
            <Button variant="outline" size="sm" disabled={form.routerLogins.length >= 50}
              onClick={() => setField("routerLogins", [...form.routerLogins, { id: crypto.randomUUID(), username: "", password: "" }])}>
              <Plus className="h-4 w-4" />Add login
            </Button>
          </div>
          {form.routerLogins.map((login, index) => (
            <div key={login.id} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1 space-y-1">
                <Label htmlFor={`router-user-${login.id}`}>Router username</Label>
                <Input id={`router-user-${login.id}`} autoComplete="off" value={login.username}
                  onChange={(e) => setField("routerLogins", form.routerLogins.map((item) => item.id === login.id ? { ...item, username: e.target.value } : item))} />
              </div>
              <div className="min-w-[200px] flex-1 space-y-1">
                <Label htmlFor={`router-pass-${login.id}`}>Router password</Label>
                <Input id={`router-pass-${login.id}`} type="password" autoComplete="new-password" value={login.password}
                  placeholder={current?.routerLogins.find((item) => item.id === login.id)?.hasPassword ? "Leave blank to keep saved password" : "Set a password"}
                  onChange={(e) => setField("routerLogins", form.routerLogins.map((item) => item.id === login.id ? { ...item, password: e.target.value } : item))} />
              </div>
              <Button variant="ghost" size="icon" aria-label={`Remove login ${index + 1}`}
                onClick={() => setField("routerLogins", form.routerLogins.filter((item) => item.id !== login.id))}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t pt-4">
          <Label htmlFor="firewall-commands" className="font-medium">Firewall commands applied during SIM activation</Label>
          <Textarea
            id="firewall-commands"
            aria-label="Firewall commands"
            value={form.firewallCommands}
            onChange={(e) => setField("firewallCommands", e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            rows={14}
            className="min-h-72 resize-y whitespace-pre font-mono text-sm leading-6"
          />
        </div>

        <div className="space-y-3 border-t pt-4">
          <Label htmlFor="ntp-commands" className="font-medium">NTP commands applied during SIM activation</Label>
          <Textarea
            id="ntp-commands"
            aria-label="NTP commands"
            value={form.ntpCommands}
            onChange={(e) => setField("ntpCommands", e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            rows={14}
            className="min-h-72 resize-y whitespace-pre font-mono text-sm leading-6"
          />
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save settings
          </Button>
          <Button variant="outline" onClick={() => settings.refetch()} disabled={saving}>
            <RefreshCw className={`h-4 w-4 ${settings.isFetching ? "animate-spin" : ""}`} />Reload
          </Button>
        </div>
      </section>
    </div>
  );
}
