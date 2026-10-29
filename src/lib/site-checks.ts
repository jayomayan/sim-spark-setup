import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { captureResultSchema, pingResultSchema, type CaptureResult, type PingResult } from "@/lib/site-connectivity";

export type SiteCheck = {
  id: string;
  site_id: string | null;
  ip: string;
  network: string | null;
  ping: PingResult | null;
  ports: CaptureResult[];
  created_at: string;
};

/** Persist one finished connectivity check (ping + port screenshots) for later review. */
export async function saveSiteCheck(input: { siteId: string | null; ip: string; network: string | null; ping: PingResult | null; ports: CaptureResult[] }) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const { error } = await supabase.from("site_checks").insert({
    site_id: input.siteId,
    ip: input.ip,
    network: input.network,
    ping: (input.ping ?? null) as Json,
    ports: input.ports as unknown as Json,
    created_by: u.user.id,
  });
  if (error) throw new Error(error.message);
}

/** Past checks for one site (by Site ID when known, otherwise by IP), newest first. */
export async function listSiteChecks(filter: { siteId?: string | null; ip?: string | null }, limit = 20): Promise<SiteCheck[]> {
  let query = supabase.from("site_checks").select("id,site_id,ip,network,ping,ports,created_at").order("created_at", { ascending: false }).limit(limit);
  if (filter.siteId) query = query.eq("site_id", filter.siteId);
  else if (filter.ip) query = query.eq("ip", filter.ip);
  else return [];
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    site_id: row.site_id,
    ip: row.ip,
    network: row.network,
    ping: row.ping ? pingResultSchema.catch(null).parse(row.ping) : null,
    ports: Array.isArray(row.ports) ? row.ports.map((p) => captureResultSchema.catch(null).parse(p)).filter((p): p is CaptureResult => p !== null) : [],
    created_at: row.created_at,
  }));
}
