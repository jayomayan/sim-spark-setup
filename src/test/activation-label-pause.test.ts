import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), config: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      inputValidator: () => builder,
      handler: (fn: unknown) => fn,
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/console-connect.server", () => ({
  memberConsoleConfig: mocks.config,
  createConsoleRequest: () => mocks.request,
}));

import { activateSim } from "@/lib/activation.functions";

const activate = activateSim as unknown as (args: {
  data: { iccid: string; label: string };
  context: { supabase: unknown; userId: string };
}) => Promise<{ alreadyActive: boolean }>;
const args = { data: { iccid: "89630000000000000001", label: "PH010065" }, context: { supabase: {}, userId: "user-1" } };
const json = (body: unknown) => new Response(JSON.stringify(body));

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("Activation to label pause", () => {
  it("waits five seconds after successful activation before any label requests", async () => {
    vi.useFakeTimers();
    mocks.config.mockResolvedValue({ apiUrl: "https://iot-api.aeris.com/iot/api", username: "test", password: "test" });
    mocks.request.mockResolvedValueOnce(json({ subscriptions: [{ imsi: "12345", state: "DEACTIVATED" }] }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ items: [{ id: 2608, fieldName: "Label#" }] }))
      .mockResolvedValueOnce(json({}));
    const result = activate(args);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
      "/subscriptions/details", "/sica/subscriptions/requests/state-changes",
    ]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).alreadyActive).toBe(false);
    expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
      "/subscriptions/details", "/sica/subscriptions/requests/state-changes",
      "/subscriptions/custom-fields", "/subscriptions/custom-fields/requests",
    ]);
  });

  it("does not pause or write labels for an already-active SIM", async () => {
    vi.useFakeTimers();
    mocks.config.mockResolvedValue({ apiUrl: "https://iot-api.aeris.com/iot/api", username: "test", password: "test" });
    mocks.request.mockResolvedValueOnce(json({ subscriptions: [{ imsi: "12345", state: "ACTIVE" }] }));
    expect((await activate(args)).alreadyActive).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});