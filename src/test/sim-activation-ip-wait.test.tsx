import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const activateSim = vi.fn(async () => ({ ok: true, simulated: false, labelWarning: null as string | null }));
  const getSimIp = vi.fn(async (): Promise<{ ip: string | null; status: string; simulated: boolean; retryAfterMs?: number }> => ({ ip: null, status: "PENDING", simulated: false }));
  const runJob = vi.fn(async (type: string, _payload?: Record<string, unknown>, _opts?: { onQueued?: (id: string) => void }) => ({ status: "done", result: null, error: null as string | null }));
  const finished: string[] = [];
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ single: async () => ({ data: { status: "running" }, error: null }) })),
      maybeSingle: async () => ({ data: { misc_enabled: mocks.miscEnabled }, error: null }),
      order: vi.fn(() => ({
        limit: vi.fn(async () => ({ data: [] })),
      })),
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: async () => ({ data: { id: "rec-1" } }),
      })),
    })),
    update: vi.fn((patch: { status?: string }) => {
      if (patch?.status) finished.push(patch.status);
      return { eq: vi.fn(async () => ({ data: null })) };
    }),
  }));
  const setRouterSimState = vi.fn(async (_a: { data: { iccid: string; state: string } }) => ({ ok: true, simulated: false }));
  return { setRouterSimState, activateSim, getSimIp, runJob, finished, from, miscEnabled: false };
});

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/activation.functions", () => ({ activateSim: mocks.activateSim, getSimIp: mocks.getSimIp, setRouterSimState: mocks.setRouterSimState }));
vi.mock("@/lib/jobs", () => ({ runJob: mocks.runJob }));
vi.mock("@/components/PageHeader", () => ({ PageHeader: () => null, meta: () => ({}) }));
vi.mock("@/components/HelperStatus", () => ({ HelperOfflineNote: () => null }));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: mocks.from,
  },
}));

import { SimActivation } from "@/routes/_authenticated/sim-activation";

const CHECK_SECONDS = 24; // two minutes of five-second checks
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function renderPage(isAdmin = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SimActivation isAdmin={isAdmin} />
    </QueryClientProvider>,
  );
}

function startActivation() {
  fireEvent.change(screen.getByLabelText("ICCID"), { target: { value: "89630000000000000001" } });
  fireEvent.change(screen.getByLabelText("Site ID"), { target: { value: "PH010065" } });
  fireEvent.click(screen.getByRole("button", { name: "Activate SIM" }));
}

describe("SIM activation IP wait", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.finished.length = 0;
    mocks.miscEnabled = false;
  });

  it("gives up on the IP address after two minutes and offers to check again", async () => {
    renderPage();
    startActivation();
    for (let i = 0; i < CHECK_SECONDS + 2; i++) await tick(5_000);

    expect(mocks.getSimIp.mock.calls.length).toBeGreaterThanOrEqual(CHECK_SECONDS - 1);
    expect(mocks.getSimIp.mock.calls.length).toBeLessThanOrEqual(CHECK_SECONDS + 1);
    expect(screen.getAllByRole("button", { name: /check for ip address again/i })).toHaveLength(1);
    expect(document.querySelectorAll('li[data-state="waiting"]')).toHaveLength(1);
    // The activation is kept as waiting rather than failed, so it can still be finished.
    expect(mocks.finished).toContain("waiting_ip");
    expect(mocks.finished).not.toContain("failed");
    expect(mocks.runJob).not.toHaveBeenCalled();
  });

  it("finishes the same activation when the IP address turns up on a later check", async () => {
    renderPage();
    startActivation();
    for (let i = 0; i < CHECK_SECONDS + 2; i++) await tick(5_000);

    mocks.getSimIp.mockResolvedValueOnce({ ip: "10.20.30.40", status: "ACTIVE", simulated: false });
    fireEvent.click(screen.getByRole("button", { name: /check for ip address again/i }));
    await tick(0);

    expect(screen.queryAllByRole("button", { name: /check for ip address again/i })).toHaveLength(0);
    expect(screen.getByText("10.20.30.40")).toBeInTheDocument();
    expect(mocks.runJob.mock.calls.map((c) => c[0])).toEqual(["ur35_firewall"]);
    expect(mocks.finished).toContain("complete");
  });

  it.each([
    ["IP address checks", () => expect(mocks.getSimIp).not.toHaveBeenCalled()],
    ["firewall deployment", () => expect(mocks.runJob.mock.calls.map((c) => c[0])).not.toContain("ur35_firewall")],
  ] as const)("completes Other activation without %s", async (_rule, assertSkipped) => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    startActivation();
    await tick(0);

    expect(mocks.activateSim).toHaveBeenCalledWith({ data: { iccid: "89630000000000000001", label: "PH010065" } });
    expect(mocks.finished).toEqual(["complete"]);
    expect(screen.getByText("Process complete")).toBeInTheDocument();
    assertSkipped();
  });

  it("offers Other only to admins", () => {
    renderPage(true);
    expect(screen.getByRole("radio", { name: "Other" })).toBeInTheDocument();
    cleanup();

    renderPage(false);
    expect(screen.queryByRole("radio", { name: "Other" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Router" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "GPS-Battery" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "GPS-Genset" })).toBeInTheDocument();
  });

  it("offers to retry when fetching the IP address fails, without activating again", async () => {
    mocks.getSimIp.mockRejectedValueOnce(new Error("Console Connect unreachable"));
    renderPage();
    startActivation();
    await tick(0);

    expect(screen.getByRole("button", { name: "Retry IP address check" })).toBeInTheDocument();
    expect(mocks.finished).toContain("failed");

    mocks.getSimIp.mockResolvedValueOnce({ ip: "10.20.30.40", status: "ACTIVE", simulated: false });
    fireEvent.click(screen.getByRole("button", { name: "Retry IP address check" }));
    await tick(0);

    expect(screen.getByText("10.20.30.40")).toBeInTheDocument();
    expect(mocks.activateSim).toHaveBeenCalledTimes(1);
    expect(mocks.getSimIp).toHaveBeenCalledTimes(2);
    expect(mocks.finished).toContain("complete");
  });

  it("pauses for Retry-After on HTTP 429 and completes without reactivation", async () => {
    mocks.getSimIp.mockResolvedValueOnce({ ip: null, status: "RATE_LIMITED", simulated: false, retryAfterMs: 45_000 });
    mocks.getSimIp.mockResolvedValueOnce({ ip: "10.20.30.40", status: "ACTIVE", simulated: false });
    renderPage();
    startActivation();
    await tick(0);
    await tick(44_999);
    expect(mocks.getSimIp).toHaveBeenCalledTimes(1);
    expect(mocks.finished).not.toContain("failed");
    await tick(1);
    expect(mocks.getSimIp).toHaveBeenCalledTimes(2);
    expect(mocks.activateSim).toHaveBeenCalledTimes(1);
    expect(mocks.finished).toContain("complete");
  });

  it("ends the two-minute window without retrying before a longer provider cooldown", async () => {
    mocks.getSimIp.mockResolvedValueOnce({ ip: null, status: "RATE_LIMITED", simulated: false, retryAfterMs: 180_000 });
    renderPage();
    startActivation();
    await tick(120_000);
    expect(mocks.getSimIp).toHaveBeenCalledTimes(1);
    expect(mocks.finished).toContain("waiting_ip");
    expect(mocks.finished).not.toContain("failed");
  });

  it("suspends a Router SIM when firewall rules fail and resumes it on retry without re-activating", async () => {
    mocks.setRouterSimState.mockClear();
    mocks.getSimIp.mockResolvedValueOnce({ ip: "10.20.30.40", status: "ACTIVE", simulated: false });
    mocks.getSimIp.mockResolvedValueOnce({ ip: "10.20.30.40", status: "ACTIVE", simulated: false });
    mocks.runJob.mockResolvedValueOnce({ status: "failed", result: null, error: "Connection refused" });
    renderPage();
    startActivation();
    await tick(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry firewall rules" }));
    await tick(0);

    expect(mocks.runJob.mock.calls.map((c) => c[0])).toEqual(["ur35_firewall", "ur35_firewall"]);
    expect(mocks.runJob.mock.calls.every((c) => c[1]?.["ip"] === "10.20.30.40")).toBe(true);
    expect(mocks.activateSim).toHaveBeenCalledTimes(1);
    expect(mocks.setRouterSimState.mock.calls.map((c) => c[0].data.state)).toEqual(["PAUSE", "ACTIVE"]);
    expect(mocks.finished).toEqual(["failed", "complete"]);
  });

  it("does not queue a second router job when the browser timed out but the helper is still running", async () => {
    mocks.getSimIp.mockResolvedValueOnce({ ip: "10.20.30.40", status: "ACTIVE", simulated: false });
    mocks.runJob.mockImplementationOnce(async (_type, _payload, opts) => {
      opts?.onQueued?.("job-running");
      throw new Error("The helper didn't respond in time");
    });
    renderPage();
    startActivation();
    await tick(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry firewall rules" }));
    await tick(0);
    expect(mocks.runJob).toHaveBeenCalledTimes(1);
    expect(mocks.finished).not.toContain("complete");
  });

  it("applies miscellaneous settings after the firewall rules when they are enabled", async () => {
    mocks.miscEnabled = true;
    mocks.getSimIp.mockResolvedValueOnce({ ip: "10.20.30.40", status: "ACTIVE", simulated: false });
    renderPage();
    await tick(0);
    startActivation();
    await tick(0);

    expect(mocks.runJob.mock.calls.map((c) => c[0])).toEqual(["ur35_firewall", "ur35_misc"]);
    expect(screen.getByText("Apply miscellaneous settings")).toBeInTheDocument();
    expect(mocks.finished).toContain("complete");
  });

  it("retries failed miscellaneous settings without re-running the firewall rules", async () => {
    mocks.miscEnabled = true;
    mocks.getSimIp.mockResolvedValueOnce({ ip: "10.20.30.40", status: "ACTIVE", simulated: false });
    mocks.getSimIp.mockResolvedValueOnce({ ip: "10.20.30.40", status: "ACTIVE", simulated: false });
    mocks.runJob.mockResolvedValueOnce({ status: "done", result: null, error: null });
    mocks.runJob.mockResolvedValueOnce({ status: "failed", result: null, error: "Router rejected the command" });
    renderPage();
    await tick(0);
    startActivation();
    await tick(0);

    fireEvent.click(screen.getByRole("button", { name: "Retry miscellaneous settings" }));
    await tick(0);

    expect(mocks.runJob.mock.calls.map((c) => c[0])).toEqual(["ur35_firewall", "ur35_misc", "ur35_misc"]);
    expect(mocks.activateSim).toHaveBeenCalledTimes(1);
    expect(mocks.finished).toEqual(["failed", "complete"]);
  });

  it("keeps miscellaneous settings out of the progress list while they are disabled", async () => {
    mocks.getSimIp.mockResolvedValueOnce({ ip: "10.20.30.40", status: "ACTIVE", simulated: false });
    renderPage();
    await tick(0);
    startActivation();
    await tick(0);

    expect(screen.queryByText("Apply miscellaneous settings")).not.toBeInTheDocument();
    expect(mocks.runJob.mock.calls.map((c) => c[0])).toEqual(["ur35_firewall"]);
  });
});
