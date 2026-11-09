import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertAdmin } from "@/lib/admin-access";

export const ACTIVATION_REPORT_PAGE_SIZE = 25;

export async function readActivationReports(client: SupabaseClient<Database>, userId: string, page: number) {
  await assertAdmin(client, userId);
  const result = await client.from("sim_activations")
    .select("id,iccid,site_id,equipment,ip,status,error,simulated,created_by,created_at,finished_at", { count: "exact" })
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(page * ACTIVATION_REPORT_PAGE_SIZE, (page + 1) * ACTIVATION_REPORT_PAGE_SIZE - 1);
  if (result.error) throw new Error("Couldn't load activation reports. Please try again.");
  const rows = result.data ?? [];
  const ids = [...new Set(rows.flatMap((row) => row.created_by ? [row.created_by] : []))];
  const names = new Map<string, string>();
  if (ids.length) {
    const profiles = await client.from("profiles").select("id,display_name,username,email").in("id", ids);
    if (profiles.error) throw new Error("Couldn't load activation users. Please try again.");
    for (const profile of profiles.data ?? []) {
      names.set(profile.id, profile.display_name || profile.username || profile.email || profile.id);
    }
  }
  return {
    rows: rows.map((row) => ({ ...row, activated_by: row.created_by ? names.get(row.created_by) ?? "Unavailable user" : "Not recorded" })),
    total: result.count ?? 0,
  };
}