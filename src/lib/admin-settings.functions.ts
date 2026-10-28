import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin-access";
import { normalizeOktaDomain, OIDC_CALLBACK_PATH } from "@/lib/okta";

const FETCH_TIMEOUT_MS = 8000;

export const checkDatabaseConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const started = Date.now();
    const { error } = await context.supabase.from("devices").select("id").limit(1);
    return {
      provider: "Lovable Cloud",
      engine: "PostgreSQL",
      connection: "Managed connection",
      connected: !error,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
    };
  });

export const listSettingsUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const [profiles, roles] = await Promise.all([
      context.supabase.from("profiles").select("id,email,display_name,created_at").order("created_at"),
      context.supabase.from("user_roles").select("user_id,role"),
    ]);
    if (profiles.error || roles.error) throw new Error("Couldn't load users");
    return (profiles.data ?? []).map((profile) => ({
      ...profile,
      role: roles.data?.some((role) => role.user_id === profile.id && role.role === "admin")
        ? "admin" as const
        : roles.data?.some((role) => role.user_id === profile.id && role.role === "operator")
          ? "operator" as const : "none" as const,
    }));
  });

export type OktaSetup = { callbackUrl: string };

export const getOktaSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OktaSetup> => {
    await assertAdmin(context.supabase, context.userId);
    const baseUrl = process.env["SUPABASE_URL"];
    if (!baseUrl) throw new Error("Lovable Cloud backend isn't connected");
    return { callbackUrl: `${baseUrl.replace(/\/+$/, "")}${OIDC_CALLBACK_PATH}` };
  });

export type OktaDomainCheck =
  | { ok: true; domain: string; issuer: string; grantTypes: string[] }
  | { ok: false; error: string };

export const checkOktaDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ domain: z.string() }).parse(data))
  .handler(async ({ context, data }): Promise<OktaDomainCheck> => {
    await assertAdmin(context.supabase, context.userId);
    const domain = normalizeOktaDomain(data.domain);
    if (!domain) return { ok: false, error: "Enter your Okta domain, e.g. yourcompany.okta.com" };
    try {
      const res = await fetch(`https://${domain}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, error: `Okta answered with status ${res.status} — check the domain.` };
      const doc = (await res.json()) as { issuer?: string; grant_types_supported?: string[] };
      if (!doc.issuer) return { ok: false, error: "The domain answered but didn't return OIDC discovery data." };
      return {
        ok: true,
        domain,
        issuer: doc.issuer,
        grantTypes: Array.isArray(doc.grant_types_supported) ? doc.grant_types_supported : [],
      };
    } catch {
      return { ok: false, error: `Couldn't reach https://${domain} from the app server.` };
    }
  });

export type OktaSignInStatus = { ready: boolean; message: string };

export const checkOktaSignIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OktaSignInStatus> => {
    await assertAdmin(context.supabase, context.userId);
    const baseUrl = process.env["SUPABASE_URL"];
    const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!baseUrl || !publishableKey) throw new Error("Lovable Cloud backend isn't connected");
    const origin = baseUrl.replace(/\/+$/, "");
    try {
      const res = await fetch(
        `${origin}/auth/v1/authorize?provider=custom:app-oidc&redirect_to=${encodeURIComponent(`${origin}${OIDC_CALLBACK_PATH}`)}`,
        {
          headers: { apikey: publishableKey },
          redirect: "manual",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );
      if (res.status >= 300 && res.status < 400) {
        return { ready: true, message: "Okta sign-in is enabled — the Sign in with Okta button is live." };
      }
      let description = "";
      try {
        const body = (await res.json()) as { error_description?: string; error?: string; msg?: string };
        description = body.error_description ?? body.msg ?? body.error ?? "";
      } catch {
        // non-JSON error body
      }
      if (/provider/i.test(description)) {
        return { ready: false, message: "Okta isn't enabled in the backend auth settings yet." };
      }
      return { ready: false, message: `Sign-in check failed (status ${res.status}).${description ? ` ${description}` : ""}` };
    } catch {
      return { ready: false, message: "Couldn't reach the sign-in endpoint. Try again in a moment." };
    }
  });
