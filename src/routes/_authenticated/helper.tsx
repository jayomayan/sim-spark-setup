import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, meta } from "@/components/PageHeader";
import { HelperStatus } from "@/components/HelperStatus";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/helper")({
  head: () => meta("Network Helper", "Install the helper that lets the console reach routers on your network."),
  component: HelperPage,
});

function HelperPage() {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-app.lovable.app";
  return (
    <>
      <PageHeader kicker="Setup" title="Network Helper"><HelperStatus /></PageHeader>
      <div className="space-y-6">
        <p className="max-w-2xl text-muted-foreground">
          Routers live on your private network, so a small helper program runs on a machine there (your old server works).
          It checks in with the console, picks up jobs like ping, SNMP, NTP and log downloads, and sends results back.
          You don't need to open any ports.
        </p>
        <Button asChild><a href="/helper/field-ops-helper.mjs" download>Download helper</a></Button>
        <ol className="panel list-decimal space-y-3 p-6 pl-10 text-sm">
          <li>On the machine, install Node.js 18 or newer, plus the <code className="font-mono">ping</code> and <code className="font-mono">snmpwalk</code> tools.</li>
          <li>Put the helper file next to the <code className="font-mono">node-scripts</code> folder from your old app and run <code className="font-mono">npm install</code> inside that folder.</li>
          <li>Start it with your console address and helper key:
            <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 font-mono text-xs">{`CONSOLE_URL=${origin} \\
AGENT_TOKEN=<your helper key> \\
UR35_USERNAME=<router user> UR35_PASSWORD=<router password> \\
node field-ops-helper.mjs`}</pre>
          </li>
          <li>The status light above turns green within a few seconds. To keep it running, add it as a system service (for example with pm2 or systemd).</li>
        </ol>
      </div>
    </>
  );
}
