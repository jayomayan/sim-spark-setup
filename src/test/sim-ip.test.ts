import { describe, expect, it, vi } from "vitest";
import { findSimIp } from "@/lib/sim-ip.server";

const json = (body: unknown) => new Response(JSON.stringify(body));

describe("Console Connect assigned IP lookup", () => {
  it("finds the IP when the latest network event has no IP", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ items: [
      { id: "data", occurred_at: "2026-11-10T05:00:00Z" },
      { id: "registration", occurred_at: "2026-11-10T05:01:00Z" },
    ] })).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ terminal_ip: "10.194.89.128", visited_nw: "network" }));
    expect(await findSimIp(request, "12345")).toEqual({ ip: "10.194.89.128", network: "network" });
    expect(request.mock.calls.map(([path]) => path)).toEqual(["/xdr/events?imsi=12345", "/xdr/events/registration", "/xdr/events/data"]);
  });

  it("prefers the latest valid IP and accepts it directly from the event list", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ items: [
      { id: "old", occurred_at: "2026-11-10T05:00:00Z", terminal_ip: "10.0.0.1" },
      { id: "new", occurred_at: "2026-11-10T05:01:00Z", terminal_ip: "10.0.0.2" },
    ] }));
    expect((await findSimIp(request, "12345")).ip).toBe("10.0.0.2");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["", "0.0.0.0", "999.1.2.3", "not an IP"])("does not use an invalid IP: %s", async (terminal_ip) => {
    const request = vi.fn().mockResolvedValueOnce(json({ items: [{ id: "event" }] })).mockResolvedValueOnce(json({ terminal_ip }));
    expect((await findSimIp(request, "12345")).ip).toBeNull();
  });

  it.each([401, 403, 429, 500])("reports HTTP %s rather than treating it as an unassigned IP", async (status) => {
    const request = vi.fn().mockResolvedValue(new Response("private response", { status }));
    await expect(findSimIp(request, "12345")).rejects.toThrow(`HTTP ${status}`);
  });

  it("keeps checking after an event is no longer available", async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ items: [{ id: "gone" }, { id: "data" }] }))
      .mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(json({ terminal_ip: "10.1.2.3" }));
    expect((await findSimIp(request, "12345")).ip).toBe("10.1.2.3");
  });
});