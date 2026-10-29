import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminSettings } from "@/components/AdminSettings";
import { meta } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/admin-settings")({
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/dashboard" });
  },
  head: () => meta("Admin Settings", "Admin-only database, user access, Okta and Console Connect settings for Frontier Tower Associates Philippines."),
  component: AdminSettings,
});