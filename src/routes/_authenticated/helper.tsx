import { createFileRoute, redirect } from "@tanstack/react-router";
import { PageHeader, meta } from "@/components/PageHeader";
import { HelperStatus } from "@/components/HelperStatus";
import { HelperSettings } from "@/components/HelperSettings";

export const Route = createFileRoute("/_authenticated/helper")({
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/dashboard" });
  },
  head: () => meta("Network Helper", "Install and configure the helper that lets the console reach routers on your network."),
  component: HelperPage,
});

function HelperPage() {
  return (
    <>
      <PageHeader kicker="Setup" title="Network Helper"><HelperStatus /></PageHeader>
      <p className="mb-6 max-w-2xl text-muted-foreground">
        Routers live on your private network, so a small helper program runs on a machine there
        (your old server works). It checks in with the console, picks up Site Connectivity Check
        screenshots and ping, SNMP, firewall and NTP jobs, and sends results back. You don't need
        to open any ports.
      </p>
      <HelperSettings />
    </>
  );
}
