import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const activateSim = vi.fn(async () => ({ ok: true, simulated: false, labelWarning: null as string | null }));
  const getSimIp = vi.fn(async () => ({ ip: null as string | null, status: "PENDING", simulated: false }));
  const runJob = vi.fn(async (type: string, _payload?: Record<string, unknown>) => ({ status: "done", result: null, error: null }));
  const finished: string[] = [];
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
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
  return { activateSim, getSimIp, runJob, finished, from };
});

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/activation.functions", () => ({ activateSim: mocks.activateSim, getSimIp: mocks.getSimIp }));
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SimActivation />
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
    expect(mocks.runJob.mock.calls.map((c) => c[0])).toEqual(["ur35_firewall", "ur35_ntp"]);
    expect(mocks.finished).toContain("complete");
  });

  it.each([
    ["IP address checks", () => expect(mocks.getSimIp).not.toHaveBeenCalled()],
    ["firewall deployment", () => expect(mocks.runJob.mock.calls.map((c) => c[0])).not.toContain("ur35_firewall")],
    ["NTP deployment", () => expect(mocks.runJob.mock.calls.map((c) => c[0])).not.toContain("ur35_ntp")],
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
});
