import { describe, expect, it } from "vitest";
import { isSupportedJobType } from "../lib/job-types";

describe("router log removal", () => {
  it("rejects router log collection jobs", () => {
    expect(isSupportedJobType("pull_logs")).toBe(false);
  });
});