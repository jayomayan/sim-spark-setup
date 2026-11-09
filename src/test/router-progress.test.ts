import { expect, it } from "vitest";
import { routerProgressSchema } from "@/lib/router-progress";

it("strips credentials and rejects unrecognized stages and unbounded rule counts", () => {
  expect(routerProgressSchema.parse({ progress: [{ stage: "connecting", password: "private", username: "private" }], token: "private" })).toEqual({ progress: [{ stage: "connecting" }] });
  expect(routerProgressSchema.safeParse({ progress: [{ stage: "raw output" }] }).success).toBe(false);
  expect(routerProgressSchema.safeParse({ progress: [{ stage: "rule", index: 51 }] }).success).toBe(false);
  expect(routerProgressSchema.safeParse({ progress: Array.from({ length: 101 }, () => ({ stage: "connecting" })) }).success).toBe(false);
});