import { describe, expect, it, vi } from "vitest";
import { findEventIp, findSimIp } from "@/lib/sim-ip.server";

const json = (body: unknown) => new Response(JSON.stringify(body));

describe("Console Connect assigned IP lookup", () => {
  it("finds the IP when the latest network event has no IP", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ items: [
      { id: "data", occurred_at: "2026-11-10T05:00:00Z" },
      { id: "registration", occurred_at: "2026-11-10T05:01:00Z" },
    ] })).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ terminal_ip: "10.194.89.128", visited_nw: "network" }));
    expect(await findEventIp(request, "12345")).toEqual({ ip: "10.194.89.128", network: "network" });
    expect(request.mock.calls.map(([path]) => path)).toEqual(["/xdr/events?imsi=12345&sort=occurred_at:desc&limit=10&additionalFields=terminal_ip,visited_nw", "/xdr/events/registration", "/xdr/events/data"]);
  });

  it("prefers the latest valid IP and accepts it directly from the event list", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ items: [
      { id: "old", occurred_at: "2026-11-10T05:00:00Z", terminal_ip: "10.0.0.1" },
      { id: "new", occurred_at: "2026-11-10T05:01:00Z", terminal_ip: "10.0.0.2" },
    ] }));
    expect((await findEventIp(request, "12345")).ip).toBe("10.0.0.2");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["", "0.0.0.0", "999.1.2.3", "not an IP"])("does not use an invalid IP: %s", async (terminal_ip) => {
    const request = vi.fn().mockResolvedValueOnce(json({ items: [{ id: "event" }] })).mockResolvedValueOnce(json({ terminal_ip }));
    expect((await findEventIp(request, "12345")).ip).toBeNull();
  });

  it.each([401, 403, 429, 500])("reports HTTP %s rather than treating it as an unassigned IP", async (status) => {
    const request = vi.fn().mockResolvedValue(new Response("private response", { status }));
    await expect(findEventIp(request, "12345")).rejects.toThrow(`HTTP ${status}`);
  });

  it("keeps checking after an event is no longer available", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ items: [{ id: "gone" }, { id: "data" }] }))
      .mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(json({ terminal_ip: "10.1.2.3" }));
    expect((await findEventIp(request, "12345")).ip).toBe("10.1.2.3");
  });

  it("stops issuing event requests on 429 and preserves Retry-After", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ items: [{ id: "one" }, { id: "two" }] }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "45" } }));
    await expect(findEventIp(request, "12345")).rejects.toMatchObject({ retryAfterMs: 45_000 });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("Assigned IP source priority", () => {
  it("uses subscription ips before any inventory or event requests", async () => {
    const request = vi.fn();
    expect(await findSimIp(request, "12345", [{ ip: "10.194.89.128", ipVersion: "IPV4" }])).toEqual({ ip: "10.194.89.128", network: null });
    expect(request).not.toHaveBeenCalled();
  });

  it("uses fixed_ips before events when subscription IPs are unavailable", async () => {
    const request = vi.fn().mockResolvedValue(json({ sims: [{ fixed_ips: [{ ip: "10.20.30.40", ip_version: "IPV4" }] }] }));
    expect((await findSimIp(request, "12345", [])).ip).toBe("10.20.30.40");
    expect(request.mock.calls).toEqual([["/sica/subscriptions/sim-resource/12345?identifier_type=IMSI"]]);
  });

  it.each([404, 405])("falls back to newest events when inventory is unavailable (HTTP %s)", async (status) => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(json({ items: [{ terminal_ip: "10.1.2.3" }] }));
    expect((await findSimIp(request, "12345")).ip).toBe("10.1.2.3");
    expect(request.mock.calls[1]?.[0]).toBe("/xdr/events?imsi=12345&sort=occurred_at:desc&limit=10&additionalFields=terminal_ip,visited_nw");
  });

  it("rejects invalid and IPv6 allocations before falling back", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ sims: [{ fixed_ips: [{ ip: "0.0.0.0" }] }] }))
      .mockResolvedValueOnce(json({ items: [] }));
    expect((await findSimIp(request, "12345", [{ ip: "2001:db8::1" }, { ip: "999.1.2.3" }, { ip: "10.1.2.3", ipVersion: "IPV6" }])).ip).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("stops all fallback requests when fixed-IP inventory is rate limited", async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "45" } }));
    await expect(findSimIp(request, "12345")).rejects.toMatchObject({ retryAfterMs: 45_000 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 500])("does not hide inventory HTTP %s errors", async (status) => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status }));
    await expect(findSimIp(request, "12345")).rejects.toThrow(`HTTP ${status}`);
    expect(request).toHaveBeenCalledTimes(1);
  });
});