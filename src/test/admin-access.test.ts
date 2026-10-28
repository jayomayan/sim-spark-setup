import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertAdmin, canAccessAdminSettings, canAccessOperationalTools } from "@/lib/admin-access";

describe("Admin Settings permissions", () => {
  it("allows Admins into settings", () => {
    expect(canAccessAdminSettings(["admin"])).toBe(true);
  });
  it("denies Non-Staff access to settings", () => {
    expect(canAccessAdminSettings(["operator"])).toBe(false);
  });
  it("allows Non-Staff all operational tools", () => {
    expect(canAccessOperationalTools(["operator"])).toBe(true);
  });
  it("denies unapproved users operational access", () => {
    expect(canAccessOperationalTools([])).toBe(false);
  });
  it("rejects a non-admin using the server role check", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await expect(assertAdmin(client, "non-staff-user")).rejects.toThrow("Only admins");
    expect(rpc).toHaveBeenCalledWith("has_role", { _user_id: "non-staff-user", _role: "admin" });
  });
  it("fails closed when the server role check fails", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: true, error: new Error("Unavailable") }) } as unknown as SupabaseClient<Database>;
    await expect(assertAdmin(client, "user")).rejects.toThrow("Only admins");
  });
});