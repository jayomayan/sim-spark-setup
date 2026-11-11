import { act, cleanup, render } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { idleActivityKey, IDLE_TIMEOUT_MS, saveActivity } from "@/lib/idle-session";

const mocks = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
  signOut: vi.fn(), navigate: vi.fn(), invalidate: vi.fn(),
  queryClient: null as QueryClient | null,
}));
vi.mock("@tanstack/react-router", () => ({
  createRootRouteWithContext: () => (options: object) => ({
    ...options, useRouteContext: () => ({ queryClient: mocks.queryClient }),
  }),
  useRouter: () => ({ navigate: mocks.navigate, invalidate: mocks.invalidate }),
  Outlet: () => null, Link: () => null, HeadContent: () => null, Scripts: () => null,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {
  signOut: mocks.signOut,
  onAuthStateChange: (callback: typeof mocks.listener) => {
    mocks.listener = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  },
} } }));
import { Route } from "@/routes/__root";

describe("Okta return after idle expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T03:00:00Z"));
    localStorage.clear();
    vi.clearAllMocks();
    mocks.queryClient = new QueryClient();
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.navigate.mockResolvedValue(undefined);
  });
  afterEach(() => { cleanup(); mocks.queryClient?.clear(); vi.useRealTimers(); localStorage.clear(); });

  function mount(event: string, signInAt: number) {
    const Root = (Route as unknown as { component: React.ComponentType }).component;
    render(<Root />);
    act(() => mocks.listener?.(event, { user: { id: "staff-a", last_sign_in_at: new Date(signInAt).toISOString() } }));
  }

  it("gives a returning Okta login a fresh 15 minutes even when delivered as INITIAL_SESSION", async () => {
    saveActivity("staff-a", Date.now() - IDLE_TIMEOUT_MS - 60_000);
    mount("INITIAL_SESSION", Date.now());
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(Number(localStorage.getItem(idleActivityKey("staff-a")))).toBe(Date.now());
    await act(async () => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1); });
    expect(mocks.signOut).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("still expires an old session restored by a page reload", async () => {
    saveActivity("staff-a", Date.now() - IDLE_TIMEOUT_MS);
    mount("INITIAL_SESSION", Date.now() - IDLE_TIMEOUT_MS - 60_000);
    await act(async () => {});
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("does not revive an expired session when recovery emits SIGNED_IN", async () => {
    saveActivity("staff-a", Date.now() - IDLE_TIMEOUT_MS);
    mount("SIGNED_IN", Date.now() - IDLE_TIMEOUT_MS - 60_000);
    await act(async () => {});
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
});