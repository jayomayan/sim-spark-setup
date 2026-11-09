import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("guards activation reports against non-admin navigation", async () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const match = router.matchRoutes("/activation-reports").at(-1);
    expect(match?.routeId).toBe("/_authenticated/activation-reports");
    const guard = router.routesById["/_authenticated/activation-reports"].options.beforeLoad;
    expect(guard).toBeTypeOf("function");
    const invoke = guard as (args: { context: { isAdmin: boolean } }) => unknown;
    expect(() => invoke({ context: { isAdmin: false } })).toThrow();
    expect(() => invoke({ context: { isAdmin: true } })).not.toThrow();
  });
  it("matches the admin settings page", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    expect(router.matchRoutes("/admin-settings").at(-1)?.routeId).toBe("/_authenticated/admin-settings");
  });
  it("preserves the existing users URL", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    expect(router.matchRoutes("/users").at(-1)?.routeId).toBe("/_authenticated/users");
  });
  it("still matches the old private browser URL", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    expect(router.matchRoutes("/private-browser").at(-1)?.routeId).toBe("/_authenticated/private-browser");
  });
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });
});
