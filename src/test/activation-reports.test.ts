import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { readActivationReports } from "@/lib/activation-reports";

function harness(admin: boolean) {
  const row = { id: "activation-1", iccid: "89630000000000000001", site_id: "PH010065", equipment: ["ur35"], ip: "10.194.89.128", status: "complete", error: null, simulated: false, created_by: "another-user", created_at: "2026-11-09T08:00:00Z", finished_at: "2026-11-09T08:01:00Z" };
  const range = vi.fn().mockResolvedValue({ data: [row], count: 57, error: null });
  const order = vi.fn();
  order.mockReturnValue({ order, range });
  const select = vi.fn().mockReturnValue({ order });
  const profiles = vi.fn().mockResolvedValue({ data: [{ id: "another-user", display_name: "Operator One", username: null, email: null }], error: null });
  const from = vi.fn((table: string) => table === "profiles" ? { select: () => ({ in: profiles }) } : { select });
  const rpc = vi.fn().mockResolvedValue({ data: admin, error: null });
  return { client: { rpc, from } as unknown as SupabaseClient<Database>, from, rpc, range, select };
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
    expect(result.rows[0]).toMatchObject({ created_by: "another-user", activated_by: "Operator One", iccid: "89630000000000000001", site_id: "PH010065", ip: "10.194.89.128", status: "complete" });
    expect(result.total).toBe(57);
  });
  it("pages through all reports rather than limiting the list to recent history", async () => {
    const h = harness(true);
    await readActivationReports(h.client, "admin", 1);
    expect(h.range).toHaveBeenCalledWith(25, 49);
  });
  it("fails closed when checking the admin role errors", async () => {
    const h = harness(true);
    h.rpc.mockResolvedValue({ data: true, error: new Error("Unavailable") });
    await expect(readActivationReports(h.client, "admin", 0)).rejects.toThrow("Only admins");
    expect(h.from).not.toHaveBeenCalled();
  });
});