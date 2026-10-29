import { describe, expect, it } from "vitest";
import { BROWSER_PORTS, captureInputSchema, isRouterIp, routerUrl } from "@/lib/private-browser";
describe("Private Browser targets", () => {
  it("browses exactly ports 80, 443 and 8443", () => {
    expect(BROWSER_PORTS).toEqual([80, 443, 8443]);
    expect(routerUrl("10.194.72.40", 80)).toBe("http://10.194.72.40:80");
    expect(routerUrl("10.194.72.40", 443)).toBe("https://10.194.72.40:443");
    expect(routerUrl("10.194.72.40", 8443)).toBe("https://10.194.72.40:8443");
    expect(captureInputSchema.safeParse({ ip: "10.194.72.40", port: 22 }).success).toBe(false);
  });
  it("limits browser targets to canonical RFC1918 addresses", () => {
    expect(isRouterIp("10.194.72.40")).toBe(true);
    expect(isRouterIp("172.16.0.1")).toBe(true);
    expect(isRouterIp("192.168.1.1")).toBe(true);
    for (const ip of ["127.0.0.1", "169.254.169.254", "8.8.8.8", "10.194.072.40", "10.0.0.300"]) expect(isRouterIp(ip)).toBe(false);
  });
});