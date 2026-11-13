import { describe, expect, it } from "vitest";
import { RETRY_WINDOW_MS, isStale, needsPause } from "@/lib/activation-process";

const now = Date.parse("2026-11-13T08:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("unfinished SIM activation cleanup", () => {
  it("uses a 3-minute retry window", () => expect(RETRY_WINDOW_MS).toBe(180_000));
  it("closes an idle run waiting for retry after 3 minutes", () => {
    expect(isStale({ status: "needs_retry", last_activity_at: ago(180_000), finished_at: null }, now)).toBe(true);
    expect(isStale({ status: "waiting_ip", last_activity_at: ago(179_000), finished_at: null }, now)).toBe(false);
  });
  it("never closes finished runs", () => {
    expect(isStale({ status: "complete", last_activity_at: ago(600_000), finished_at: ago(600_000) }, now)).toBe(false);
  });
  it("pauses only Router SIMs the app activated", () => {
    expect(needsPause({ equipment: ["ur35"], sim_activated: true, simulated: false })).toBe(true);
    expect(needsPause({ equipment: ["gps_battery"], sim_activated: true, simulated: false })).toBe(false);
    expect(needsPause({ equipment: ["ur35"], sim_activated: false, simulated: false })).toBe(false);
  });
});
