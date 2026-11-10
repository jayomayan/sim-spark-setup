import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin-access";
import { DEFAULT_SITE_TARGETS, siteTargetsSchema } from "@/lib/site-connectivity";

export const getSiteTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: member, error: accessError } = await context.supabase.rpc("is_member", { _user_id: context.userId });
    if (accessError || !member) throw new Error("Access denied");
    const { data, error } = await context.supabase.from("site_connectivity_settings").select("targets").eq("id", 1).maybeSingle();
    if (error) throw new Error("Could not load connectivity settings.");
    return data ? siteTargetsSchema.parse(data.targets) : DEFAULT_SITE_TARGETS;
  });

export const saveSiteTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => siteTargetsSchema.parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("site_connectivity_settings").upsert({ id: 1, targets: data, updated_at: new Date().toISOString() });
    if (error) throw new Error("Could not save connectivity settings.");
    return data;
  });