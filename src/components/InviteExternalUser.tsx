import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, RefreshCw, UserPlus } from "lucide-react";
import { inviteExternalUser } from "@/lib/users.functions";
import { inviteSchema } from "@/lib/invitations";
import { formatInvitationCredentials, generateTemporaryPassword } from "@/lib/invitation-credentials";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const empty = { username: "", displayName: "", phone: "", email: "", password: "" };
export function InviteExternalUser() {
  const invite = useServerFn(inviteExternalUser);
  const qc = useQueryClient();
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [savedCredentials, setSavedCredentials] = useState<{ username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const credentials = savedCredentials ?? form;
  function updateField(key: keyof typeof empty, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedCredentials(null); setCopied(false); setResult("");
  }
  function generatePassword() {
    try { updateField("password", generateTemporaryPassword()); setError(""); }
    catch { setError("Couldn't generate a password. Please enter a strong password manually."); }
  }
  async function copyCredentials() {
    try {
      const text = formatInvitationCredentials(credentials.username, credentials.password);
      await navigator.clipboard.writeText(text);
      setCopied(true); setError("");
    } catch { setCopied(false); setError("Couldn't copy login details. Check the username and strong password, and allow clipboard access."); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const validated = inviteSchema.safeParse(form);
    if (!validated.success) { setError(validated.error.issues[0]?.message ?? "Check the invitation details"); return; }
    setBusy(true); setError(""); setResult("");
    try {
      const saved = await invite({ data: validated.data });
      setSavedCredentials({ username: saved.username, password: validated.data.password });
      setCopied(false);
      setForm(empty);
      setResult(`Account created for ${saved.username}. Share the username and temporary password privately. A password change is required at first login.${saved.emailRequested ? " Email was not sent: a sending domain has not been configured." : ""}`);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't invite user"); }
    finally { setBusy(false); await qc.invalidateQueries({ queryKey: ["admin", "invitation-history"] }); }
  }
  return <form onSubmit={submit} className="mb-10 max-w-2xl space-y-4 border-b pb-8">
    <h2 className="text-xl font-semibold">Invite external user</h2>
    <div className="grid gap-4 sm:grid-cols-2">
      {([{ key: "displayName", label: "Full name", type: "text" }, { key: "username", label: "Username", type: "text" }, { key: "phone", label: "Phone number", type: "tel" }, { key: "email", label: "Email (optional)", type: "email" }, { key: "password", label: "Temporary password", type: "password" }] as const).map(({ key, label, type }) => <div key={key} className={key === "password" ? "space-y-2 sm:col-span-2" : "space-y-2"}>
        <Label htmlFor={`invite-${key}`}>{label}</Label>
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-0 flex-1 basis-48" id={`invite-${key}`} type={type} autoComplete={key === "password" ? "new-password" : "off"} required={key !== "email"} disabled={busy} value={form[key]} placeholder={key === "phone" ? "+639171234567" : undefined} onChange={(event) => updateField(key, event.target.value)} />
          {key === "password" && <Button type="button" variant="outline" disabled={busy} onClick={generatePassword}><RefreshCw className="h-4 w-4" />Generate password</Button>}
        </div>
      </div>)}
    </div>
    <p className="text-xs text-muted-foreground">At least 12 characters, including uppercase, lowercase, a number and a symbol. Username accounts require admin assistance for password recovery.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result && <p role="status" className="text-sm text-foreground">{result}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={busy}><UserPlus className="h-4 w-4" />{busy ? "Inviting…" : "Invite user"}</Button>
      <Button type="button" variant="outline" disabled={busy || !credentials.username || !credentials.password} onClick={copyCredentials}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied login details" : "Copy username and password"}</Button>
    </div>
  </form>;
}