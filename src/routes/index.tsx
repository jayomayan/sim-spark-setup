import { createFileRoute, Link } from "@tanstack/react-router";
import logo from "@/assets/fta-logo.png.asset.json";
import { TowerWireframe } from "@/components/TowerWireframe";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Field Ops Console — Routers & SIM Activation" },
      { name: "description", content: "Activate IoT SIMs, provision UR35 routers and manage field devices in one place." },
      { property: "og:title", content: "Field Ops Console — Routers & SIM Activation" },
      { property: "og:description", content: "Activate SIMs, provision UR35 routers and manage field devices." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <main className="relative flex min-h-screen flex-col justify-center overflow-hidden px-6 py-16">
      <TowerWireframe
        className="pointer-events-none absolute -right-16 top-1/2 w-[46rem] max-w-none -translate-y-1/2 opacity-[0.16] sm:right-0 md:w-[52rem]"
      />
      <TowerWireframe
        className="pointer-events-none absolute left-1/2 top-1/2 w-[34rem] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.10] lg:hidden"
      />
      <div className="relative mx-auto w-full max-w-3xl">
        <img src={logo.url} alt="Frontier Tower Associates Philippines" className="mb-8 w-60" />
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Field Ops Console</p>
        <h1 className="mt-4 text-5xl font-bold leading-tight tracking-tight md:text-6xl">
          Every site router,<br />one console.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Activate SIMs, push firewall and time settings to UR35 routers, check devices and pull their logs.
        </p>
        <div className="mt-10 flex gap-3">
          <Button asChild size="lg"><Link to="/auth">Sign in</Link></Button>
          <Button asChild size="lg" variant="secondary"><Link to="/dashboard">Open dashboard</Link></Button>
        </div>
        <div className="mt-16 grid gap-px overflow-hidden rounded-lg border bg-border font-mono text-sm sm:grid-cols-3">
          {["SIM activation", "Router tools", "Device logs"].map((t, i) => (
            <div key={t} className="bg-card p-5"><span className="text-primary">0{i + 1}</span> {t}</div>
          ))}
        </div>
      </div>
    </main>
  );
}
