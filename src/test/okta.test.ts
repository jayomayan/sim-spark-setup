import { describe, expect, it } from "vitest";
import { normalizeOktaDomain, OIDC_CALLBACK_PATH } from "../lib/okta";

describe("Okta domain normalization", () => {
  it("strips scheme, path and case", () => {
    expect(normalizeOktaDomain("https://Company.Okta.com/admin")).toBe("company.okta.com");
    expect(normalizeOktaDomain("  MyOrg.OktaCommerce.com/ ")).toBe("myorg.oktacommerce.com");
  });

  it("keeps plain domains", () => {
    expect(normalizeOktaDomain("company.okta.com")).toBe("company.okta.com");
  });

  it("rejects values without a dot, or empty input", () => {
    expect(normalizeOktaDomain("localhost")).toBeNull();
    expect(normalizeOktaDomain("")).toBeNull();
    expect(normalizeOktaDomain("   ")).toBeNull();
    expect(normalizeOktaDomain("okta")).toBeNull();
  });

  it("uses the standard OIDC callback path", () => {
    expect(OIDC_CALLBACK_PATH).toBe("/auth/v1/callback");
  });
});
