import { describe, expect, it } from "vitest";
import { externalLoginEmail, inviteSchema, loginEmail, strongPassword } from "@/lib/invitations";

describe("External invitation rules", () => {
  const invitation = { username: "partner.one", displayName: "Partner One", phone: "+639171234567", email: "", password: "Temporary!4839" };
  it("allows external invitations without an email", () => {
    expect(inviteSchema.parse(invitation).email).toBe("");
  });
  it("retains an optional contact email", () => {
    expect(inviteSchema.parse({ ...invitation, email: "partner@example.com" }).email).toBe("partner@example.com");
  });
  it("maps normalized usernames to the same credential for invitation and login", () => {
    expect(externalLoginEmail("Partner.One")).toBe("partner.one@external.field-ops.invalid");
    expect(loginEmail(" PARTNER.ONE ")).toBe(externalLoginEmail("partner.one"));
  });
  it("preserves existing email sign-in", () => {
    expect(loginEmail(" admin@example.com ")).toBe("admin@example.com");
  });
  it.each(["Short!123", "lowercase!1234", "UPPERCASE!1234", "NoNumbersHere!", "NoSymbols12345"])("rejects a weak password: %s", (password) => {
    expect(strongPassword.safeParse(password).success).toBe(false);
  });
  it("accepts a strong temporary password", () => {
    expect(strongPassword.safeParse(invitation.password).success).toBe(true);
  });
  it("rejects usernames that can change the auth domain", () => {
    expect(inviteSchema.safeParse({ ...invitation, username: "admin@example.com" }).success).toBe(false);
  });
});