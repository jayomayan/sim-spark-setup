import { createFileRoute, Link } from "@tanstack/react-router";
import logo from "@/assets/fta-logo.png.asset.json";
import towerWireframe from "@/assets/cellular-tower-wireframe.png";
import { Button } from "@/components/ui/button";
import { useSignedIn } from "@/lib/session-context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Field Ops Console — Routers & SIM Activation" },
      { name: "description", content: "Activate IoT SIMs and provision UR35 routers in one place." },
      { property: "og:title", content: "Field Ops Console — Routers & SIM Activation" },
      { property: "og:description", content: "Activate SIMs and provision UR35 routers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const signedIn = useSignedIn();
  return (
    <main className="relative flex min-h-screen flex-col justify-center overflow-hidden px-6 py-16">
      <img
        src={towerWireframe}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[88svh] w-auto max-w-none -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.12] lg:left-auto lg:right-0 lg:translate-x-0 lg:opacity-[0.30]"
      />
      <div className="relative mx-auto w-full max-w-3xl">
        <img src={logo.url} alt="Frontier Tower Associates Philippines" className="mb-8 w-60" />
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Field Ops Console</p>
        <h1 className="mt-4 text-5xl font-bold leading-tight tracking-tight md:text-6xl">
          Every site router,<br />one console.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Activate SIMs and push firewall and time settings to UR35 routers.
        </p>
        <div className="mt-10 flex gap-3">
          {signedIn === false && <Button asChild size="lg"><Link to="/auth">Sign in</Link></Button>}
          {signedIn === true && <Button asChild size="lg" variant="secondary"><Link to="/dashboard">Open dashboard</Link></Button>}
        </div>
        <div className="mt-16 grid gap-px overflow-hidden rounded-lg border bg-border font-mono text-sm sm:grid-cols-2">
          {["SIM activation", "Router tools"].map((t, i) => (
            <div key={t} className="bg-card p-5"><span className="text-primary">0{i + 1}</span> {t}</div>
          ))}
        </div>
      </div>
    </main>
  );
}
