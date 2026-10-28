import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin-access";

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