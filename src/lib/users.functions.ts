import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Admin-only: grant or remove a user's access role. */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; role: "admin" | "operator" | "none" }) => {
    if (!/^[0-9a-f-]{36}$/.test(d.userId)) throw new Error("Invalid user");
    if (!["admin", "operator", "none"].includes(d.role)) throw new Error("Invalid role");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Only admins can change access");
    if (data.userId === context.userId && data.role !== "admin") throw new Error("You can't remove your own admin access");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    if (data.role !== "none") {
      const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, role: data.role });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
