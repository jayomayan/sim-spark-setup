import { afterEach, describe, expect, it } from "vitest";
import { brokeredPreviewStorage } from "../../deploy/auth-storage";

afterEach(() => window.localStorage.removeItem("standalone-storage-test"));

describe("standalone authentication persistence", () => {
  it("persists and removes sessions on the current origin without a parent broker", () => {
    const storage = brokeredPreviewStorage();
    if (!storage) throw new Error("Browser storage must be available");
    storage.setItem("standalone-storage-test", "test-session-value");
    expect(storage.getItem("standalone-storage-test")).toBe("test-session-value");
    expect(window.localStorage.getItem("standalone-storage-test")).toBe("test-session-value");
    storage.removeItem("standalone-storage-test");
    expect(storage.getItem("standalone-storage-test")).toBeNull();
  });
});