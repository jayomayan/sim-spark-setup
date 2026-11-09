import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS, idleActivityKey, saveActivity, startIdleSession } from "@/lib/idle-session";

describe("Inactive sessions", () => {
  let stop = () => {};
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T00:00:00Z")); localStorage.clear(); });
  afterEach(() => { stop(); vi.useRealTimers(); localStorage.clear(); });
  const start = () => {
    const warning = vi.fn();
    const expire = vi.fn();
    const controller = startIdleSession("user-a", warning, expire);
    stop = controller.stop;
    return { warning, expire, controller };
  };
  it("signs out at exactly 15 minutes, not before", () => {
    expect(IDLE_TIMEOUT_MS).toBe(900000);
    const { expire } = start();
    vi.advanceTimersByTime(899999);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(expire).toHaveBeenCalledTimes(1);
  });
  it("warns one minute before sign-out", () => {
    expect(IDLE_WARNING_MS).toBe(60000);
    const { warning } = start();
    vi.advanceTimersByTime(840000);
    expect(warning).toHaveBeenLastCalledWith(60);
  });
  it("user interaction restarts the inactivity window", () => {
    const { expire } = start();
    vi.advanceTimersByTime(600000);
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(899000);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(expire).toHaveBeenCalledTimes(1);
  });
  it("Stay signed in dismisses the warning and restarts the window", () => {
    const { warning, expire, controller } = start();
    vi.advanceTimersByTime(840000);
    controller.staySignedIn();
    expect(warning).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(60000);
    expect(expire).not.toHaveBeenCalled();
  });
  it("reload does not reset an expired session", () => {
    saveActivity("user-a", Date.now() - 900000);
    expect(start().expire).toHaveBeenCalledTimes(1);
  });
  it("uses activity from another tab of the same account", () => {
    const { expire } = start();
    vi.advanceTimersByTime(840000);
    saveActivity("user-a");
    window.dispatchEvent(new StorageEvent("storage", { key: idleActivityKey("user-a") }));
    vi.advanceTimersByTime(60000);
    expect(expire).not.toHaveBeenCalled();
  });
  it("does not use another account's activity", () => {
    const { expire } = start();
    vi.advanceTimersByTime(840000);
    saveActivity("user-b");
    vi.advanceTimersByTime(60000);
    expect(expire).toHaveBeenCalledTimes(1);
  });
  it("expires on wake before new interaction can extend a sleeping session", () => {
    const { expire, controller } = start();
    vi.setSystemTime(Date.now() + 900001);
    controller.staySignedIn();
    expect(expire).toHaveBeenCalledTimes(1);
  });
  it("stops timers and listeners when signed out", () => {
    const { expire } = start();
    stop();
    vi.advanceTimersByTime(900000);
    window.dispatchEvent(new Event("keydown"));
    expect(expire).not.toHaveBeenCalled();
  });
});