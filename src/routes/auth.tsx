import { createFileRoute, useNavigate } from "@tanstack/react-router";
import logo from "@/assets/fta-logo.png.asset.json";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginEmail } from "@/lib/invitations";
import { useSignedIn } from "@/lib/session-context";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Field Ops Console" },
      { name: "description", content: "Sign in with Okta, username or email to manage routers and activate SIMs." },
      { property: "og:title", content: "Sign in — Field Ops Console" },
      { property: "og:description", content: "Staff sign in with Okta; invited partners use their username and password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const signedIn = useSignedIn();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  // The root listener updates this when OAuth finishes exchanging the callback.
  useEffect(() => {
    if (signedIn) void navigate({ to: "/dashboard", replace: true });
  }, [signedIn, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const error = params.get("error_description") ?? hash.get("error_description");
    if (error) toast.error(error);
  }, []);

  async function okta() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "custom:app-oidc" as never,
      options: { redirectTo: `${window.location.origin}/auth` },
    });
    if (error) toast.error("Okta sign-in isn't set up yet. Use email for now.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(email), password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        toast.success("If that email has an account, a reset link is on its way.");
        setMode("signin");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <img src={logo.url} alt="Frontier Tower Associates Philippines" className="mb-6 w-52" />
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Field Ops Console</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {mode === "signin" ? "Sign in" : "Reset password"}
        </h1>

        {mode === "signin" && (
          <>
            <Button onClick={okta} className="mt-8 w-full" size="lg">Staff sign in with Okta</Button>
            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />External partners<span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={submit} className={mode === "signin" ? "space-y-4" : "mt-8 space-y-4"}>
          <div className="space-y-2">
            <Label htmlFor="email">{mode === "signin" ? "Username or email" : "Email"}</Label>
            <Input id="email" type={mode === "signin" ? "text" : "email"} autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {mode !== "forgot" && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? "text" : "password"} required minLength={8} autoComplete="current-password" className="pr-10" value={password} onChange={(e) => setPassword(e.target.value)} />
                <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-9 w-10 text-muted-foreground" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</Button>
              </div>
            </div>
          )}
          <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Send reset link"}
          </Button>
        </form>

        <div className="mt-6 flex justify-between text-sm text-muted-foreground">
          {mode === "signin" ? (
            <Button variant="link" className="h-auto p-0 text-muted-foreground" onClick={() => setMode("forgot")}>Forgot password?</Button>
          ) : (
            <Button variant="link" className="h-auto p-0 text-muted-foreground" onClick={() => setMode("signin")}>← Back to sign in</Button>
          )}
        </div>
        <p className="mt-8 text-xs text-muted-foreground">
          Moving from the old app? Use “Forgot password?” with your work email to set a new password.
        </p>
      </div>
    </main>
  );
}
