import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export function canAccessAdminSettings(roles: readonly string[]) {
  return roles.includes("admin");
}

export function canAccessOperationalTools(roles: readonly string[]) {
  return roles.includes("admin") || roles.includes("operator");
}

export async function assertAdmin(client: SupabaseClient<Database>, userId: string) {
  const { data, error } = await client.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || data !== true) throw new Error("Only admins can access these settings");
}