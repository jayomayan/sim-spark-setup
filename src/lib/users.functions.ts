import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin-access";
import { z } from "zod";

/** Admin-only: grant or remove a user's access role. */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; role: "admin" | "operator" | "none" }) => z.object({ userId: z.string().uuid(), role: z.enum(["admin", "operator", "none"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.userId === context.userId && data.role !== "admin") throw new Error("You can't remove your own admin access");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.role !== "none") {
      const { error } = await supabaseAdmin.from("user_roles").upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error("Couldn't update user access");
      const { error: cleanupError } = await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId).neq("role", data.role);
      if (cleanupError) throw new Error("Couldn't finish updating user access. Please retry.");
    } else {
      const { error } = await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
      if (error) throw new Error("Couldn't remove user access");
    }
    return { ok: true };
  });
