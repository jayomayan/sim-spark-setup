import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin-access";
import { helperSettingsInput } from "@/lib/helper-settings";

export const getHelperSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { helperConfig } = await import("@/lib/helper-settings.server");
    const config = await helperConfig(context.supabase);
    const { ur35Password, ...safe } = config;
    return { ...safe, hasRouterPassword: Boolean(ur35Password), hasKey: true };
  });

export const saveHelperSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => helperSettingsInput.parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { saveHelperConfig } = await import("@/lib/helper-settings.server");
    return saveHelperConfig(context.supabase, data);
  });

/** Creates the single-use code that a new machine exchanges for the helper key. */
export const createHelperInstallCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { createEnrollment } = await import("@/lib/helper-settings.server");
    return createEnrollment(context.supabase, context.userId);
  });

/** Start over: the old key stops working, so a machine must be reinstalled. */
export const rotateHelperKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("helper_settings")
      .update({ agent_token_cipher: null, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error("Couldn't reset the helper key.");
    return { ok: true };
  });
