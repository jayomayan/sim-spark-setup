import { describe, expect, it } from "vitest";
import { captureResultSchema, pingResultSchema } from "@/lib/site-connectivity";

// A saved check must always be renderable from history: the exact shapes the
// helper returns are what gets stored and later parsed back.
describe("saved site checks", () => {
  it("round-trips a full check payload (ping + four port captures)", () => {
    const ping = { reachable: true, transmitted: 4, received: 4, packetLoss: 0, minMs: 0.5, avgMs: 1.2, maxMs: 2.1 };
    const capture = { port: 80, accessible: true, httpStatus: 200, screenshot: "data:image/jpeg;base64,QUJD" };
    expect(pingResultSchema.parse(ping)).toEqual(ping);
    for (const port of [80, 443, 8443, 8080]) {
      expect(captureResultSchema.parse({ ...capture, port }).port).toBe(port);
    }
  });

  it("round-trips a failed check (no ping replies, inaccessible port)", () => {
    const ping = { reachable: false, transmitted: 4, received: 0, packetLoss: 100, minMs: null, avgMs: null, maxMs: null };
    const capture = { port: 8443, accessible: false, httpStatus: null, screenshot: "data:image/jpeg;base64,QUJD" };
    expect(pingResultSchema.parse(ping).reachable).toBe(false);
    expect(captureResultSchema.parse(capture).accessible).toBe(false);
  });
});
