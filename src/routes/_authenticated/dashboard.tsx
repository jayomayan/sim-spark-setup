import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, meta } from "@/components/PageHeader";
import { HelperStatus } from "@/components/HelperStatus";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => meta("Dashboard", "Overview of devices, SIM activations and router jobs."),
  component: Dashboard,
});

const count = async (table: "devices" | "sim_activations") =>
  (await supabase.from(table).select("*", { count: "exact", head: true })).count ?? 0;

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [devices, sims] = await Promise.all([count("devices"), count("sim_activations")]);
      const { data: jobs } = await supabase.from("agent_jobs").select("id,type,status,created_at,error").in("type", ["ping", "snmp_walk", "ur35_firewall", "ur35_ntp"]).order("created_at", { ascending: false }).limit(8);
      return { devices, sims, jobs: jobs ?? [] };
    },
  });
  const stats = [
    { label: "Devices", value: data?.devices, to: "/devices" as const },
    { label: "SIM activations", value: data?.sims, to: "/sim-activation" as const },
  ];
  return (
    <>
      <PageHeader kicker="Overview" title="Dashboard"><HelperStatus /></PageHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="panel p-5 transition-colors hover:border-primary">
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className="mt-2 font-mono text-3xl font-semibold">{s.value ?? "—"}</p>
          </Link>
        ))}
      </div>
      <h2 className="mt-10 mb-3 font-semibold">Recent router jobs</h2>
      <div className="panel divide-y">
        {data?.jobs.length ? data.jobs.map((j) => (
          <div key={j.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="font-mono">{j.type}</span>
            <span className="truncate text-muted-foreground">{j.error ?? ""}</span>
            <span className={j.status === "done" ? "text-primary" : j.status === "failed" ? "text-destructive" : "text-warning"}>{j.status}</span>
          </div>
        )) : <p className="px-4 py-6 text-sm text-muted-foreground">No jobs yet.</p>}
      </div>
    </>
  );
}
