import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isSupportedJobType, type JobType } from "@/lib/job-types";
export type { JobType } from "@/lib/job-types";

export type JobResult = { status: string; result: unknown; error: string | null };

/** Queue a job for the on-network helper and wait for it to finish. */
export async function runJob(
  type: JobType,
  payload: Record<string, unknown>,
  opts: { timeoutMs?: number; onQueued?: (id: string) => void } = {},
): Promise<JobResult> {
  if (!isSupportedJobType(type)) throw new Error("Unsupported router job");
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("agent_jobs")
    .insert({ type, payload: payload as Json, created_by: u.user.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  opts.onQueued?.(data.id);
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const { data: j } = await supabase
      .from("agent_jobs")
      .select("status,result,error")
      .eq("id", data.id)
      .single();
    if (j && (j.status === "done" || j.status === "failed")) return j as JobResult;
  }
  throw new Error("The helper didn't respond in time. Check it's running on your network.");
}

export const isPrivateIp = (ip: string) => {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
};

export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0] ?? {});
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
}
