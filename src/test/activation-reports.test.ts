import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { activationReportsCsv, escapeReportSearch, exportActivationReports, readActivationReports, reportDateRange } from "@/lib/activation-reports";

function harness(admin: boolean) {
  const row = { id: "activation-1", iccid: "89630000000000000001", site_id: "PH010065", equipment: ["ur35"], ip: "10.194.89.128", status: "COMPLETED", error: null, simulated: false, created_by: "another-user", created_at: "2026-11-09T08:00:00Z", finished_at: "2026-11-09T08:01:00Z" };
  const range = vi.fn().mockResolvedValue({ data: [row], count: 57, error: null });
  const limit = vi.fn().mockResolvedValue({ data: [row], count: 1, error: null });
  const order = vi.fn();
  order.mockReturnValue({ order, range, limit });
  const lt = vi.fn().mockReturnValue({ order });
  const gte = vi.fn().mockReturnValue({ order, lt });
  const or = vi.fn().mockReturnValue({ order, gte, lt });
  const select = vi.fn().mockReturnValue({ order, or, gte, lt });
  const profiles = vi.fn().mockResolvedValue({ data: [{ id: "another-user", display_name: "Operator One", username: null, email: null }], error: null });
  const from = vi.fn((table: string) => table === "profiles" ? { select: () => ({ in: profiles }) } : { select });
  const rpc = vi.fn().mockResolvedValue({ data: admin, error: null });
  return { client: { rpc, from } as unknown as SupabaseClient<Database>, from, rpc, range, limit, select, or, gte, lt };
}

describe("Admin-only activation reports", () => {
  it("rejects non-admins before reading any activation reports", async () => {
    const h = harness(false);
    await expect(readActivationReports(h.client, "operator", 0)).rejects.toThrow("Only admins");
    expect(h.from).not.toHaveBeenCalled();
  });
  it("includes activations from other users for an admin", async () => {
    const h = harness(true);
    const result = await readActivationReports(h.client, "admin", 0);
    expect(h.rpc).toHaveBeenCalledWith("has_role", { _user_id: "admin", _role: "admin" });
    expect(result.rows[0]).toMatchObject({ created_by: "another-user", activated_by: "Operator One", iccid: "89630000000000000001", site_id: "PH010065", ip: "10.194.89.128", status: "COMPLETED" });
    expect(result.total).toBe(57);
  });
  it("pages through all reports rather than limiting the list to recent history", async () => {
    const h = harness(true);
    await readActivationReports(h.client, "admin", 1);
    expect(h.range).toHaveBeenCalledWith(25, 49);
  });
  it("filters reports by ICCID, Site ID or IP address when a search term is given", async () => {
    const h = harness(true);
    await readActivationReports(h.client, "admin", 0, "PH010065");
    expect(h.or).toHaveBeenCalledWith("iccid.ilike.%PH010065%,site_id.ilike.%PH010065%,ip.ilike.%PH010065%");
  });
  it("does not filter when the search term is blank", async () => {
    const h = harness(true);
    await readActivationReports(h.client, "admin", 0, "   ");
    expect(h.or).not.toHaveBeenCalled();
  });
  it("escapes wildcards and commas so a search term cannot alter the filter", () => {
    expect(escapeReportSearch("10.194.%,_x")).toBe("10.194.\\%\\,\\_x");
  });
  it("fails closed when checking the admin role errors", async () => {
    const h = harness(true);
    h.rpc.mockResolvedValue({ data: true, error: new Error("Unavailable") });
    await expect(readActivationReports(h.client, "admin", 0)).rejects.toThrow("Only admins");
    expect(h.from).not.toHaveBeenCalled();
  });
});

describe("Activation report date filter", () => {
  it("filters by Manila calendar days, with the end date inclusive", async () => {
    const h = harness(true);
    await readActivationReports(h.client, "admin", 0, "", "2026-11-01", "2026-11-09");
    expect(h.gte).toHaveBeenCalledWith("created_at", "2026-11-01T00:00:00+08:00");
    expect(h.lt).toHaveBeenCalledWith("created_at", "2026-11-10T00:00:00+08:00");
  });
  it("swaps the dates when the start is after the end", () => {
    expect(reportDateRange("2026-11-09", "2026-11-01")).toEqual({ from: "2026-11-01T00:00:00+08:00", toExclusive: "2026-11-10T00:00:00+08:00" });
  });
  it("ignores invalid dates instead of filtering everything out", async () => {
    const h = harness(true);
    await readActivationReports(h.client, "admin", 0, "", "not-a-date", "2026-13-40");
    expect(h.gte).not.toHaveBeenCalled();
    expect(h.lt).not.toHaveBeenCalled();
  });
  it("supports a single-sided date filter", async () => {
    const h = harness(true);
    await readActivationReports(h.client, "admin", 0, "", "", "2026-11-09");
    expect(h.gte).not.toHaveBeenCalled();
    expect(h.lt).toHaveBeenCalledWith("created_at", "2026-11-10T00:00:00+08:00");
  });
});

describe("Activation report CSV export", () => {
  it("rejects non-admins before exporting", async () => {
    const h = harness(false);
    await expect(exportActivationReports(h.client, "operator")).rejects.toThrow("Only admins");
    expect(h.from).not.toHaveBeenCalled();
  });
  it("exports all matching rows up to the limit instead of one page", async () => {
    const h = harness(true);
    const result = await exportActivationReports(h.client, "admin", "PH010065", "2026-11-01", "2026-11-09");
    expect(h.limit).toHaveBeenCalledWith(5000);
    expect(h.range).not.toHaveBeenCalled();
    expect(h.or).toHaveBeenCalledWith("iccid.ilike.%PH010065%,site_id.ilike.%PH010065%,ip.ilike.%PH010065%");
    expect(h.gte).toHaveBeenCalledWith("created_at", "2026-11-01T00:00:00+08:00");
    expect(result.rows[0]).toMatchObject({ activated_by: "Operator One", iccid: "89630000000000000001" });
    expect(result.truncated).toBe(false);
  });
  it("writes a header row and escapes commas, quotes and line breaks", () => {
    const csv = activationReportsCsv([
      { iccid: "89630000000000000001", site_id: "PH010065", equipment: ["ur35", "gps_battery"], ip: "10.194.89.128", status: "UNFINISHED", error: "Line one\nLine \"two\"", simulated: true, created_at: "2026-11-09T08:00:00Z", finished_at: null, activated_by: "Operator One" },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Date,User,ICCID,Site ID,Equipment,IP address,Status,Error,Finished,Test mode");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('2026-11-09T08:00:00Z,Operator One,89630000000000000001,PH010065,"ur35, gps_battery",10.194.89.128,UNFINISHED,"Line one\nLine ""two""",,Yes');
  });
});
