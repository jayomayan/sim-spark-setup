import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, KeyRound, Loader2, Plus, RefreshCw, Save, Terminal, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { createHelperInstallCode, getHelperSettings, rotateHelperKey, saveHelperSettings } from "@/lib/helper.functions";
import { buildInstallCommand, ENROLLMENT_TTL_MINUTES, type FirewallRule } from "@/lib/helper-settings";
import { HELPER_VERSION } from "@/lib/helper-release";
import { useHelperStatus } from "@/components/HelperStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Settings = Awaited<ReturnType<typeof getHelperSettings>>;
type Form = {
  ur35Username: string;
  ur35Password: string;
  ur35FirewallPath: string;
  ur35NtpPath: string;
  firewallRules: FirewallRule[];
  ntpEnabled: boolean;
  ntpServers: string;
  ntpTimezone: string;
};

const toForm = (s: Settings): Form => ({
  ur35Username: s.ur35Username,
  ur35Password: "",
  ur35FirewallPath: s.ur35FirewallPath,
  ur35NtpPath: s.ur35NtpPath,
  firewallRules: s.firewallRules,
  ntpEnabled: s.ntp.enabled,
  ntpServers: s.ntp.servers.join(", "),
  ntpTimezone: s.ntp.timezone,
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

function RuleRow({ rule, index, onChange, onRemove }: { rule: FirewallRule; index: number; onChange: (r: FirewallRule) => void; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[200px] flex-1 space-y-1">
        <Label htmlFor={`rule-text-${index}`}>Firewall rule</Label>
        <Input
          id={`rule-text-${index}`}
          value={rule.rule}
          placeholder="e.g. accept tcp/443"
          onChange={(e) => onChange({ ...rule, rule: e.target.value })}
        />
      </div>
      <div className="min-w-[200px] flex-1 space-y-1">
        <Label htmlFor={`rule-desc-${index}`}>Description</Label>
        <Input
          id={`rule-desc-${index}`}
          value={rule.description}
          placeholder="What this rule is for"
          onChange={(e) => onChange({ ...rule, description: e.target.value })}
        />
      </div>
      <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove rule ${rule.description || index + 1}`}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
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
  const setRule = (index: number, rule: FirewallRule) =>
    setForm((f) => (f ? { ...f, firewallRules: f.firewallRules.map((r, i) => (i === index ? rule : r)) } : f));

  async function submit() {
    setSaving(true);
    try {
      await save({ data: form });
      setForm((f) => (f ? { ...f, ur35Password: "" } : f));
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ur35-user">Router username</Label>
            <Input id="ur35-user" autoComplete="off" value={form.ur35Username} onChange={(e) => setField("ur35Username", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ur35-pass">Router password</Label>
            <Input
              id="ur35-pass"
              type="password"
              autoComplete="new-password"
              value={form.ur35Password}
              placeholder={current?.hasRouterPassword ? "Leave blank to keep saved password" : "Set a password"}
              onChange={(e) => setField("ur35Password", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ur35-fw">Firewall rules path</Label>
            <Input id="ur35-fw" value={form.ur35FirewallPath} onChange={(e) => setField("ur35FirewallPath", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ur35-ntp">NTP settings path</Label>
            <Input id="ur35-ntp" value={form.ur35NtpPath} onChange={(e) => setField("ur35NtpPath", e.target.value)} />
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Firewall rules applied during SIM activation</h4>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={form.firewallRules.length >= 50}
              onClick={() => setField("firewallRules", [...form.firewallRules, { rule: "", description: "" }])}
            >
              <Plus className="h-4 w-4" />Add rule
            </Button>
          </div>
          {form.firewallRules.map((rule, index) => (
            <RuleRow
              key={index}
              rule={rule}
              index={index}
              onChange={(next) => setRule(index, next)}
              onRemove={() => setField("firewallRules", form.firewallRules.filter((_, i) => i !== index))}
            />
          ))}
          {form.firewallRules.length === 0 && <p className="text-sm text-muted-foreground">No rules yet — the built-in template is used instead.</p>}
        </div>

        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-3">
            <Switch id="ntp-enabled" checked={form.ntpEnabled} onCheckedChange={(v) => setField("ntpEnabled", Boolean(v))} />
            <Label htmlFor="ntp-enabled">Apply NTP settings during SIM activation</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ntp-servers">Time servers</Label>
              <Input id="ntp-servers" value={form.ntpServers} onChange={(e) => setField("ntpServers", e.target.value)} placeholder="pool.ntp.org, time.google.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ntp-tz">Timezone</Label>
              <Input id="ntp-tz" value={form.ntpTimezone} onChange={(e) => setField("ntpTimezone", e.target.value)} placeholder="Asia/Manila" />
            </div>
          </div>
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
