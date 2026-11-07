import { describe, expect, it } from "vitest";
import { invitationAuditRecord } from "@/lib/invitation-audit";

describe("Admin invitation audit", () => {
  const input = { username: "partner.one", displayName: "Partner One", phone: "+639171234567", email: "partner@example.com", password: "NeverLog!1234" };
  it("records the inviting admin and recipient without any password", () => {
    const record = invitationAuditRecord(input, "admin-id", "Jay");
    expect(record).toEqual({ admin_id: "admin-id", admin_name: "Jay", username: "partner.one", display_name: "Partner One", phone: "+639171234567", email: "partner@example.com", status: "started", email_status: "not_sent" });
    expect(JSON.stringify(record)).not.toContain(input.password);
  });
  it("does not claim an email was sent for a no-email invitation", () => {
    expect(invitationAuditRecord({ ...input, email: "" }, "admin-id", "Jay").email_status).toBe("not_requested");
  });
});