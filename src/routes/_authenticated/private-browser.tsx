import { createFileRoute, redirect } from "@tanstack/react-router";

// Compatibility URL: this tool is now called Site Connectivity Check.
export const Route = createFileRoute("/_authenticated/private-browser")({
  beforeLoad: () => {
    throw redirect({ to: "/site-connectivity-check", replace: true });
  },
});
