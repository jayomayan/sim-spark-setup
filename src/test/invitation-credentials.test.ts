import { describe, expect, it } from "vitest";
import { formatInvitationCredentials, generateTemporaryPassword } from "@/lib/invitation-credentials";
import { strongPassword } from "@/lib/invitations";

describe("Invitation credentials", () => {
  it("generates strong temporary passwords with every required character class", () => {
    for (let i = 0; i < 100; i++) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(20);
      expect(strongPassword.safeParse(password).success).toBe(true);
    }
  });
  it("copies the normalized login username and exact temporary password together", () => {
    expect(formatInvitationCredentials(" Partner.One ", "Temporary!4839"))
      .toBe("Username: partner.one\nTemporary password: Temporary!4839");
  });
  it("rejects incomplete credentials before copying", () => {
    expect(() => formatInvitationCredentials("", "Temporary!4839")).toThrow();
    expect(() => formatInvitationCredentials("partner.one", "weak")).toThrow();
  });
});