import { describe, expect, it, vi } from "vitest";
import { checkConsoleRateLimit } from "@/lib/console-rate-limit";

describe("Console Connect cooldown", () => {
  it("defaults to a thirty-second pause when no Retry-After is supplied", () => {
    expect(() => checkConsoleRateLimit(new Response(null, { status: 429 }))).toThrow(expect.objectContaining({ retryAfterMs: 30_000 }));
  });
  it("respects Retry-After dates", () => {
    const now = Date.parse("2026-11-10T05:19:00Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      expect(() => checkConsoleRateLimit(new Response(null, { status: 429, headers: { "Retry-After": "Tue, 10 Nov 2026 05:20:00 GMT" } })))
        .toThrow(expect.objectContaining({ retryAfterMs: 60_000 }));
    } finally { vi.restoreAllMocks(); }
  });
});