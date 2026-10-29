import { describe, expect, it } from "vitest";
import { BROWSER_PORTS, captureInputSchema, isRouterIp, portLabel, routerUrl, pingInputSchema, pingResultSchema } from "@/lib/site-connectivity";
describe("Site Connectivity Check targets", () => {
  it("browses exactly ports 80, 443, 8443 and 8080", () => {
    expect(BROWSER_PORTS).toEqual([80, 443, 8443, 8080]);
    expect(routerUrl("10.194.72.40", 80)).toBe("http://10.194.72.40:80");
    expect(routerUrl("10.194.72.40", 443)).toBe("https://10.194.72.40:443");
    expect(routerUrl("10.194.72.40", 8443)).toBe("https://10.194.72.40:8443");
    expect(routerUrl("10.194.72.40", 8080)).toBe("http://10.194.72.40:8080");
    expect(portLabel(8080)).toBe("HTTP / HTTPS");
    expect(portLabel(443)).toBe("HTTPS");
    for (const port of BROWSER_PORTS) expect(captureInputSchema.safeParse({ ip: "10.194.72.40", port }).success).toBe(true);
    for (const port of [22, 8081, 8080.5]) expect(captureInputSchema.safeParse({ ip: "10.194.72.40", port }).success).toBe(false);
  });
  it("limits browser targets to canonical RFC1918 addresses", () => {
    expect(isRouterIp("10.194.72.40")).toBe(true);
    expect(isRouterIp("172.16.0.1")).toBe(true);
    expect(isRouterIp("192.168.1.1")).toBe(true);
    for (const ip of ["127.0.0.1", "169.254.169.254", "8.8.8.8", "10.194.072.40", "10.0.0.300"]) expect(isRouterIp(ip)).toBe(false);
  });
  it("keeps ping targets private and accepts only an IP", () => {
    expect(pingInputSchema.safeParse({ ip: "10.194.72.40" }).success).toBe(true);
    for (const ip of ["8.8.8.8", "127.0.0.1", "10.0.0.1;ping"]) expect(pingInputSchema.safeParse({ ip }).success).toBe(false);
    expect(pingInputSchema.safeParse({ ip: "10.0.0.1", count: 100 }).success).toBe(false);
  });
  it("validates four-probe ping results and distinguishes no replies", () => {
    const result = { reachable: true, transmitted: 4, received: 3, packetLoss: 25, minMs: 1, avgMs: 2, maxMs: 3 };
    expect(pingResultSchema.safeParse(result).success).toBe(true);
    expect(pingResultSchema.safeParse({ ...result, packetLoss: 0 }).success).toBe(false);
    expect(pingResultSchema.safeParse({ ...result, transmitted: 100 }).success).toBe(false);
    expect(pingResultSchema.safeParse({ ...result, reachable: false }).success).toBe(false);
    expect(pingResultSchema.safeParse({ reachable: false, transmitted: 4, received: 0, packetLoss: 100, minMs: null, avgMs: null, maxMs: null }).success).toBe(true);
  });
});