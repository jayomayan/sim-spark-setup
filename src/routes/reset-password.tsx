import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { strongPassword } from "@/lib/invitations";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Field Ops Console" },
      { name: "description", content: "Choose a new password for your Field Ops Console account." },
      { property: "og:title", content: "Set a new password — Field Ops Console" },
      { property: "og:description", content: "Choose a new password for your account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    setRecovery(new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!recovery) { toast.error("Open the password-reset link from your email"); return; }
    const validated = strongPassword.safeParse(password);
    if (!validated.success) { toast.error(validated.error.issues[0]?.message ?? "Choose a strong password"); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated");
    navigate({ to: "/dashboard" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Set a new password</h1>
        <div className="space-y-2">
          <Label htmlFor="pw">New password</Label>
          <Input id="pw" type="password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">At least 12 characters, with uppercase, lowercase, a number and a symbol.</p>
        {!recovery && <p role="alert" className="text-sm text-destructive">Open the password-reset link from your email.</p>}
        <Button type="submit" className="w-full" disabled={busy || !recovery}>{busy ? "Saving…" : "Save password"}</Button>
      </form>
    </main>
  );
}
