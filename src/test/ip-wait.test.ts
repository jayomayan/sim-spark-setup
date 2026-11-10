import { describe, expect, it } from "vitest";
import { IP_WAIT_POLL_MS, IP_WAIT_TIMEOUT_MS, ipWaitOpen, ipWaitSecondsLeft } from "@/lib/ip-wait";

describe("SIM activation IP wait window", () => {
  it("waits two minutes before handing the choice back to the user", () => {
    expect(IP_WAIT_TIMEOUT_MS).toBe(120_000);
  });

  it("keeps checking while the window is open and stops at two minutes", () => {
    expect(ipWaitOpen(0)).toBe(true);
    expect(ipWaitOpen(119_999)).toBe(true);
    expect(ipWaitOpen(120_000)).toBe(false);
    expect(ipWaitOpen(180_000)).toBe(false);
  });

  it("counts the remaining time down without going negative", () => {
    expect(ipWaitSecondsLeft(0)).toBe(120);
    expect(ipWaitSecondsLeft(60_000)).toBe(60);
    expect(ipWaitSecondsLeft(119_500)).toBe(1);
    expect(ipWaitSecondsLeft(120_000)).toBe(0);
    expect(ipWaitSecondsLeft(240_000)).toBe(0);
  });

  it("waits five seconds between completed IP checks", () => {
    expect(IP_WAIT_POLL_MS).toBe(5_000);
  });
});
