import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin-access";
import { z } from "zod";
import { inviteSchema, externalLoginEmail, strongPassword } from "./invitations";

export const inviteExternalUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof inviteSchema>) => inviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: externalLoginEmail(data.username), password: data.password, email_confirm: true,
      user_metadata: { name: data.displayName },
    });
    if (error || !created.user) throw new Error("Couldn't invite user. The username may already be taken, or the password was rejected.");
    const userId = created.user.id;
    try {
      // No access role is issued until the immutable first-login requirement exists.
      const security = await supabaseAdmin.from("account_security").insert({ user_id: userId, invited_by: context.userId });
      if (security.error) throw security.error;
      const profile = await supabaseAdmin.from("profiles").update({ username: data.username, email: data.email || null, phone: data.phone, display_name: data.displayName }).eq("id", userId);
      if (profile.error) throw profile.error;
      const role = await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "operator" });
      if (role.error) throw role.error;
    } catch {
      const rollback = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (rollback.error) throw new Error("Invitation setup failed. An account without operational access may remain; contact an admin before retrying.");
      throw new Error("Couldn't finish the invitation. No account was kept; please retry.");
    }
    return { username: data.username, emailRequested: Boolean(data.email), emailSent: false as const };
  });

export const getPasswordRequirement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("account_security").select("must_change_password").eq("user_id", context.userId).maybeSingle();
    if (error) throw new Error("Couldn't check password requirements");
    return { required: data?.must_change_password === true };
  });

export const completeFirstLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { currentPassword: string; password: string }) => z.object({ currentPassword: z.string().min(1).max(128), password: strongPassword }).refine((d) => d.currentPassword !== d.password, "Choose a different password").parse(input))
  .handler(async ({ data, context }) => {
    const requirement = await context.supabase.from("account_security").select("must_change_password").eq("user_id", context.userId).maybeSingle();
    if (requirement.error || !requirement.data?.must_change_password) throw new Error("No first-login password change is pending");
    // Use an isolated auth client: the request-scoped Data API client has no Auth session.
    const identity = await context.supabase.auth.getUser();
    if (identity.error || !identity.data.user?.email) throw new Error("Sign in again before changing your password");
    const url = process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_PUBLISHABLE_KEY'];
    if (!url || !key) throw new Error("Password service unavailable");
    const { createClient } = await import("@supabase/supabase-js");
    const authClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const verified = await authClient.auth.signInWithPassword({ email: identity.data.user.email, password: data.currentPassword });
    if (verified.error || verified.data.user?.id !== context.userId) throw new Error("Current password is incorrect");
    const changed = await authClient.auth.updateUser({ password: data.password, current_password: data.currentPassword });
    if (changed.error) throw new Error(changed.error.message);
    await authClient.auth.signOut({ scope: "local" });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const saved = await supabaseAdmin.from("account_security").update({ must_change_password: false, password_changed_at: new Date().toISOString() }).eq("user_id", context.userId).eq("must_change_password", true).select("user_id").single();
    if (saved.error) throw new Error("Password changed, but access is still locked. Retry using your new password as the current password and choose another new password.");
    return { ok: true };
  });

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
