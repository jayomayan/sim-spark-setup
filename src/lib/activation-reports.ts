import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertAdmin } from "@/lib/admin-access";

export const ACTIVATION_REPORT_PAGE_SIZE = 25;
export const ACTIVATION_REPORT_EXPORT_LIMIT = 5000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Report dates are shown in Manila time, so date filters mean Manila calendar days.
const MANILA_OFFSET = "+08:00";

export function escapeReportSearch(search: string) {
  return search.trim().slice(0, 100).replace(/[\\%_,]/g, (char) => `\\${char}`);
}

export function normalizeReportDate(value: string | undefined) {
  const date = (value ?? "").trim();
  return DATE_PATTERN.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : "";
}

export function reportDateRange(from: string, to: string) {
  const start = normalizeReportDate(from);
  const end = normalizeReportDate(to);
  let lower = start;
  let upper = end;
  if (lower && upper && lower > upper) [lower, upper] = [upper, lower];
  return {
    from: lower ? `${lower}T00:00:00${MANILA_OFFSET}` : "",
    // Inclusive end date: the exclusive bound is the start of the next Manila day.
    toExclusive: upper ? new Date(Date.parse(`${upper}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) + `T00:00:00${MANILA_OFFSET}` : "",
  };
}

const REPORT_COLUMNS = "id,iccid,site_id,equipment,ip,status,error,simulated,created_by,created_at,finished_at";

type ReportClient = SupabaseClient<Database>;

function filteredQuery(client: ReportClient, search: string, from: string, to: string) {
  const term = escapeReportSearch(search);
  const range = reportDateRange(from, to);
  let query = client.from("sim_activations").select(REPORT_COLUMNS, { count: "exact" });
  if (term) query = query.or(`iccid.ilike.%${term}%,site_id.ilike.%${term}%,ip.ilike.%${term}%`);
  if (range.from) query = query.gte("created_at", range.from);
  if (range.toExclusive) query = query.lt("created_at", range.toExclusive);
  return query.order("created_at", { ascending: false }).order("id", { ascending: false });
}

async function resolveUserNames(client: ReportClient, rows: { created_by: string | null }[]) {
  const ids = [...new Set(rows.flatMap((row) => row.created_by ? [row.created_by] : []))];
  const names = new Map<string, string>();
  if (ids.length) {
    const profiles = await client.from("profiles").select("id,display_name,username,email").in("id", ids);
    if (profiles.error) throw new Error("Couldn't load activation users. Please try again.");
    for (const profile of profiles.data ?? []) {
      names.set(profile.id, profile.display_name || profile.username || profile.email || profile.id);
    }
  }
  return names;
}

export async function readActivationReports(client: ReportClient, userId: string, page: number, search = "", from = "", to = "") {
  await assertAdmin(client, userId);
  const result = await filteredQuery(client, search, from, to)
    .range(page * ACTIVATION_REPORT_PAGE_SIZE, (page + 1) * ACTIVATION_REPORT_PAGE_SIZE - 1);
  if (result.error) throw new Error("Couldn't load activation reports. Please try again.");
  const rows = result.data ?? [];
  const names = await resolveUserNames(client, rows);
  return {
    rows: rows.map((row) => ({ ...row, activated_by: row.created_by ? names.get(row.created_by) ?? "Unavailable user" : "Not recorded" })),
    total: result.count ?? 0,
  };
}

export async function exportActivationReports(client: ReportClient, userId: string, search = "", from = "", to = "") {
  await assertAdmin(client, userId);
  const result = await filteredQuery(client, search, from, to).limit(ACTIVATION_REPORT_EXPORT_LIMIT);
  if (result.error) throw new Error("Couldn't export activation reports. Please try again.");
  const rows = result.data ?? [];
  const names = await resolveUserNames(client, rows);
  return {
    rows: rows.map((row) => ({ ...row, activated_by: row.created_by ? names.get(row.created_by) ?? "Unavailable user" : "Not recorded" })),
    truncated: rows.length >= ACTIVATION_REPORT_EXPORT_LIMIT,
  };
}

type ExportRow = {
  iccid: string;
  site_id: string | null;
  equipment: string[];
  ip: string | null;
  status: string;
  error: string | null;
  simulated: boolean;
  created_at: string;
  finished_at: string | null;
  activated_by: string;
};

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function activationReportsCsv(rows: ExportRow[]) {
  const header = ["Date", "User", "ICCID", "Site ID", "Equipment", "IP address", "Status", "Error", "Finished", "Test mode"];
  const lines = rows.map((row) => [
    row.created_at,
    row.activated_by,
    row.iccid,
    row.site_id ?? "",
    row.equipment.join(", "),
    row.ip ?? "",
    row.status,
    row.error ?? "",
    row.finished_at ?? "",
    row.simulated ? "Yes" : "No",
  ].map(csvCell).join(","));
  return [header.join(","), ...lines].join("\r\n");
}
