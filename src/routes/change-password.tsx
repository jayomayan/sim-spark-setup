import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { completeFirstLogin } from "@/lib/users.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/change-password")({
  head: () => ({ meta: [
    { title: "First-login password change — Field Ops Console" },
    { name: "description", content: "Replace your temporary password before accessing Field Ops Console." },
    { property: "og:title", content: "First-login password change — Field Ops Console" },
    { property: "og:description", content: "Secure your invited Field Ops Console account with a new password." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: ChangePassword,
});
function ChangePassword() {
  const complete = useServerFn(completeFirstLogin);
  const navigate = useNavigate(); const router = useRouter(); const qc = useQueryClient();
  const [currentPassword, setCurrent] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setBusy(true);
    try { await complete({ data: { currentPassword, password } }); qc.clear(); await router.invalidate(); await navigate({ to: "/dashboard", replace: true }); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't change password"); }
    finally { setBusy(false); }
  }
  async function signOut() { await qc.cancelQueries(); qc.clear(); await supabase.auth.signOut(); await navigate({ to: "/auth", replace: true }); }
  return <main className="flex min-h-screen items-center justify-center px-5"><form onSubmit={submit} className="w-full max-w-md space-y-5">
    <h1 className="text-3xl font-bold">Change your password</h1>
    <p className="text-sm text-muted-foreground">Replace your temporary password before continuing.</p>
    <div className="space-y-2"><Label htmlFor="current">Temporary or current password</Label><Input id="current" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrent(event.target.value)} /></div>
    <div className="space-y-2"><Label htmlFor="new">New password</Label><Input id="new" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
    <div className="space-y-2"><Label htmlFor="confirm">Confirm new password</Label><Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></div>
    <p className="text-xs text-muted-foreground">At least 12 characters, with uppercase, lowercase, a number and a symbol.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Change password and continue"}</Button>
    <Button type="button" variant="ghost" className="w-full" onClick={signOut}>Sign out</Button>
  </form></main>;
}