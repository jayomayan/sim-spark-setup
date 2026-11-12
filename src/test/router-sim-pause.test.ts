import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), config: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = { middleware: () => builder, inputValidator: () => builder, handler: (fn: unknown) => fn };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/console-connect.server", () => ({ memberConsoleConfig: mocks.config, createConsoleRequest: () => mocks.request }));
import { setRouterSimState } from "@/lib/activation.functions";
const pause = setRouterSimState as unknown as (args: { data: { iccid: string; state: string }; context: { supabase: unknown; userId: string } }) => Promise<unknown>;
const args = { data: { iccid: "89630000000000000001", state: "PAUSE" }, context: { supabase: {}, userId: "user-1" } };
const json = (state: string) => new Response(JSON.stringify({ subscriptions: [{ imsi: "12345", subscriptionState: state }] }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("Router Pause provider contract", () => {
  it("sends PAUSE, not SUSPENDED, and waits for confirmed provider readback", async () => {
    vi.useFakeTimers();
    mocks.config.mockResolvedValue({ apiUrl: "https://iot-api.aeris.com", username: "test", password: "test" });
    mocks.request.mockResolvedValueOnce(json("ACTIVE")).mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(json("ACTIVE")).mockResolvedValueOnce(json("PAUSE"));
    let settled = false;
    const result = pause(args).then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toBe(false);
    expect(JSON.parse(mocks.request.mock.calls[1][1].body).change.state).toBe("PAUSE");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toEqual({ ok: true, simulated: false });
  });

  it("never reports Pause when the provider keeps reporting ACTIVE", async () => {
    vi.useFakeTimers();
    mocks.config.mockResolvedValue({ apiUrl: "https://iot-api.aeris.com", username: "test", password: "test" });
    mocks.request.mockResolvedValue(json("ACTIVE"));
    const result = expect(pause(args)).rejects.toThrow("has not confirmed");
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
  });

  it("does not simulate successful Pause when Console Connect is unconfigured", async () => {
    mocks.config.mockResolvedValue({});
    await expect(pause(args)).rejects.toThrow("not configured");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});