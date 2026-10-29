import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin-access";
import { consoleSettingsSchema, integrationSchema } from "@/lib/console-connect";

export const getConsoleSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { readConsoleConfig } = await import("@/lib/console-connect.server");
    return Promise.all((["site_lookup"] as const).map(async (integration) => {
      const config = await readConsoleConfig(context.supabase, integration);
      const { password, ...publicConfig } = config;
      return { ...publicConfig, hasPassword: Boolean(password), ready: Boolean(config.apiUrl && config.username && password) };
    }));
  });

export const saveConsoleSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => consoleSettingsSchema.parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { readConsoleConfig } = await import("@/lib/console-connect.server");
    const { encryptPassword } = await import("@/lib/db-connection.server");
    const current = await readConsoleConfig(context.supabase, data.integration);
    const lookup = data.integration === "site_lookup";
    const password = lookup ? data.password || current.password : current.password;
    if (!password) throw new Error("Password is required for the first save.");
    const { error } = await context.supabase.from("console_connect_settings").upsert({
      integration: data.integration, token_url: lookup ? data.tokenUrl : current.tokenUrl, api_url: data.apiUrl.replace(/\/+$/, ""),
      client_id: lookup ? data.clientId : current.clientId, username: lookup ? data.username : current.username,
      password_cipher: lookup ? encryptPassword(password) : null, updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("Couldn't save Console Connect settings.");
    return { ok: true };
  });

export const testConsoleSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => integrationSchema.parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { readConsoleConfig, consoleToken } = await import("@/lib/console-connect.server");
    const config = await readConsoleConfig(context.supabase, data);
    if (!config.apiUrl || !config.username || !config.password) return { ok: false, message: "Console Connect credentials are not configured yet." };
    try {
      await consoleToken(config);
      return { ok: true, message: "Console Connect sign-in succeeded." };
    } catch { return { ok: false, message: "Couldn't connect or sign in to Console Connect. Check the saved address and account details." }; }
  });