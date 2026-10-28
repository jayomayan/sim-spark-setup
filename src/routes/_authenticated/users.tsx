import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminSettings } from "@/components/AdminSettings";
import { meta } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/users")({
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/dashboard" });
  },
  head: () => meta("User Settings", "Manage Admin and Non-Staff access to the Frontier Tower field operations console."),
  component: UsersPage,
});

function UsersPage() {
  return <AdminSettings defaultTab="users" />;
}
