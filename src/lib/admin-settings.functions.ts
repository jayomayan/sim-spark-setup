import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin-access";
import { normalizeOktaDomain, OIDC_CALLBACK_PATH } from "@/lib/okta";
import { encryptPassword, decryptPassword, testDbConnection } from "@/lib/db-connection.server";

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

const connectionProfileInput = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, "Label is required").max(80),
  host: z.string().trim().min(1, "Host is required").max(253),
  port: z.coerce.number().int().min(1).max(65535).default(5432),
  databaseName: z.string().trim().min(1, "Database name is required").max(63).default("postgres"),
  username: z.string().trim().min(1, "Username is required").max(63),
  password: z.string().max(200).optional(),
});

export type ConnectionProfile = {
  id: string;
  label: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  hasPassword: boolean;
  updatedAt: string;
};

export const listConnectionProfiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConnectionProfile[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("database_connections")
      .select("id,label,host,port,database_name,username,password_cipher,updated_at")
      .order("created_at");
    if (error) throw new Error("Couldn't load saved connections");
    return (data ?? []).map((row) => ({
      id: row.id,
      label: row.label,
      host: row.host,
      port: row.port,
      databaseName: row.database_name,
      username: row.username,
      hasPassword: Boolean(row.password_cipher),
      updatedAt: row.updated_at,
    }));
  });

export const saveConnectionProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => connectionProfileInput.parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const row = {
      label: data.label,
      host: data.host,
      port: data.port,
      database_name: data.databaseName,
      username: data.username,
      updated_at: new Date().toISOString(),
      ...(data.password && data.password.length > 0 ? { password_cipher: encryptPassword(data.password) } : {}),
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("database_connections")
        .update(row)
        .eq("id", data.id);
      if (error) throw new Error("Couldn't update the saved connection");
      return { id: data.id };
    }
    const { data: inserted, error } = await context.supabase
      .from("database_connections")
      .insert(row)
      .select("id")
      .single();
    if (error || !inserted) throw new Error("Couldn't save the connection");
    return { id: inserted.id };
  });

export const deleteConnectionProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("database_connections")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error("Couldn't delete the saved connection");
    return { ok: true };
  });

export type ConnectionTest = { ok: boolean; message: string; latencyMs: number };

export const setupConnectionProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase.from("database_connections")
      .select("host,port,database_name,username,password_cipher").eq("id", data.id).single();
    if (error || !row) throw new Error("Couldn't find that saved connection");
    const { initializeExternalDatabase } = await import("@/lib/db-provisioning.server");
    return initializeExternalDatabase({ host: row.host, port: row.port, database: row.database_name,
      username: row.username, password: row.password_cipher ? decryptPassword(row.password_cipher) : "" });
  });

export const testConnectionProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.union([
      z.object({ id: z.string().uuid() }),
      z.object({ connection: connectionProfileInput }),
    ]).parse(data),
  )
  .handler(async ({ context, data }): Promise<ConnectionTest> => {
    await assertAdmin(context.supabase, context.userId);
    let creds;
    if ("id" in data) {
      const { data: row, error } = await context.supabase
        .from("database_connections")
        .select("host,port,database_name,username,password_cipher")
        .eq("id", data.id)
        .single();
      if (error || !row) throw new Error("Couldn't find that saved connection");
      creds = {
        host: row.host,
        port: row.port,
        database: row.database_name,
        username: row.username,
        password: row.password_cipher ? decryptPassword(row.password_cipher) : "",
      };
    } else {
      creds = {
        host: data.connection.host,
        port: data.connection.port,
        database: data.connection.databaseName,
        username: data.connection.username,
        password: data.connection.password ?? "",
      };
    }
    return testDbConnection(creds);
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
