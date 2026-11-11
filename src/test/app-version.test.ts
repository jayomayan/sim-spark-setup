import { describe, expect, it } from "vitest";
import { appVersion } from "../../scripts/app-version.mjs";

describe("appVersion", () => {
  it("starts with the UTC build date as YYYY.M.D", () => {
    const version = appVersion(new Date(Date.UTC(2026, 10, 11)));
    expect(version).toMatch(/^2026\.11\.11(\+[0-9a-f]{7})?$/);
  });

  it("does not zero-pad month or day", () => {
    const version = appVersion(new Date(Date.UTC(2026, 0, 5)));
    expect(version.startsWith("2026.1.5")).toBe(true);
  });
});
