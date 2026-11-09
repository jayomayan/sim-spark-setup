import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ statuses: ["pending", "running", "running", "done"], results: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  from: () => ({
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) }),
    select: () => ({ eq: () => ({ single: async () => ({ data: { status: mocks.statuses.shift(), result: mocks.results.shift() ?? null, error: null } }) }) }),
  }),
} }));

import { runJob } from "@/lib/jobs";
afterEach(() => vi.useRealTimers());

it("reports actual queued, running and completed helper states without repeating unchanged states", async () => {
  vi.useFakeTimers();
  const onStatus = vi.fn();
  const job = runJob("ur35_firewall", { ip: "10.194.89.128" }, { onStatus });
  await vi.advanceTimersByTimeAsync(6000);
  expect(await job).toMatchObject({ status: "done" });
  expect(onStatus.mock.calls).toEqual([["pending"], ["running"], ["done"]]);
});

it("reports changing progress while the same job remains running and on completion", async () => {
  vi.useFakeTimers();
  mocks.statuses = ["running", "running", "done"];
  mocks.results = [{ progress: [{ stage: "connecting" }] }, { progress: [{ stage: "connecting" }, { stage: "authenticated" }] }, { verified: true, progress: [{ stage: "verified" }] }];
  const onProgress = vi.fn();
  const job = runJob("ur35_firewall", { ip: "10.194.89.128" }, { onProgress });
  await vi.advanceTimersByTimeAsync(4500);
  expect(await job).toMatchObject({ status: "done" });
  expect(onProgress.mock.calls).toEqual([
    [[{ stage: "connecting" }]],
    [[{ stage: "connecting" }, { stage: "authenticated" }]],
    [[{ stage: "verified" }]],
  ]);
});