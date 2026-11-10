import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("public/helper/field-ops-helper.mjs", "utf8");
const start = source.indexOf("const sameTarget =");
const end = source.indexOf("const handlers =", start);
const sameTarget = runInNewContext(`${source.slice(start, end)}; sameTarget`, { URL });
describe("configured connectivity endpoints", () => {
  const allowed = [{ port: 9000, protocol: "https" }];
  it("permits the configured protocol/port only on the exact target IP", () => {
    expect(sameTarget("https://10.1.2.3:9000/login", "10.1.2.3", allowed)).toBe(true);
    for (const url of ["http://10.1.2.3:9000", "https://10.1.2.3:443", "https://10.1.2.4:9000", "https://example.com:9000", "https://user:pass@10.1.2.3:9000"]) expect(sameTarget(url, "10.1.2.3", allowed)).toBe(false);
  });
  it("captures the configured custom endpoint and preserves protocol in its result", async () => {
    const goto = vi.fn(async () => ({ status: () => 200 }));
    let current = "";
    const page = { on: vi.fn(), goto: async (url: string, options: unknown) => { current = url; return goto(url, options); }, url: () => current, waitForTimeout: vi.fn(), screenshot: async () => Buffer.from("image") };
    const context = { route: vi.fn(), routeWebSocket: vi.fn(), newPage: async () => page, close: vi.fn() };
    const captureStart = source.indexOf("  async site_capture(");
    const captureEnd = source.indexOf("\n};", captureStart);
    const capture = runInNewContext(`({${source.slice(captureStart, captureEnd)}}).site_capture`, { checkIp: (ip: string) => ip, sameTarget, getBrowser: async () => ({ newContext: async () => context }), SITE_PORTS: {} });
    const result = await capture({ ip: "10.1.2.3", port: 9000, protocol: "https", allowedTargets: allowed });
    expect(goto.mock.calls[0]?.[0]).toBe("https://10.1.2.3:9000");
    expect(result).toMatchObject({ port: 9000, protocol: "https", accessible: true, httpStatus: 200 });
    expect(context.close).toHaveBeenCalledOnce();
    await expect(capture({ ip: "10.1.2.3", port: 9000, protocol: "http", allowedTargets: allowed })).rejects.toThrow("not enabled");
  });
});