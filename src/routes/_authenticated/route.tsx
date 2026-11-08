import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouteContext, useRouterState } from "@tanstack/react-router";
import logo from "@/assets/fta-logo.png.asset.json";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Cpu, Gauge, Globe, ListTree, LogOut, Menu, Radio, Server, Settings, X } from "lucide-react";
import { canAccessAdminSettings, canAccessOperationalTools } from "@/lib/admin-access";
import { supabase } from "@/integrations/supabase/client";
import { HelperStatus } from "@/components/HelperStatus";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const security = await supabase.from("account_security").select("must_change_password").eq("user_id", data.user.id).maybeSingle();
    if (security.error) throw new Error("Couldn't check account security. Please try again.");
    if (security.data?.must_change_password) throw redirect({ to: "/change-password" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    const list = (roles ?? []).map((r) => r.role);
    return { user: data.user, isAdmin: canAccessAdminSettings(list), isMember: canAccessOperationalTools(list) };
  },
  component: Layout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge },
  { to: "/sim-activation", label: "SIM Activation", icon: Radio },
  { to: "/site-connectivity-check", label: "Site Connectivity Check", icon: Globe },
  { to: "/devices", label: "Devices", icon: Cpu },
  { to: "/snmp-walk", label: "SNMP Walk", icon: ListTree },
] as const;

function Layout() {
  const { user, isAdmin, isMember } = useRouteContext({ from: "/_authenticated" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (!isMember) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Waiting for access</h1>
          <p className="mt-2 text-muted-foreground">
            You're signed in as {user.email}. An admin needs to give you access before you can use the console.
          </p>
          <Button variant="secondary" className="mt-6" onClick={signOut}>Sign out</Button>
        </div>
      </main>
    );
  }

  const items = isAdmin ? [...NAV, { to: "/helper", label: "Helper", icon: Server } as const, { to: "/admin-settings", label: "Admin Settings", icon: Settings } as const] : NAV;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <img src={logo.url} alt="Frontier Tower Associates Philippines" className="w-44 px-2" />
        <nav className="mt-6 flex-1 space-y-1">
          {items.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to}
              className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              activeProps={{ className: "bg-sidebar-accent text-primary" }}>
              <Icon className="h-4 w-4" />{label}
            </Link>
          ))}
        </nav>
        <HelperStatus className="px-2" />
        <div className="mt-4 border-t border-sidebar-border pt-4">
          <p className="truncate px-2 text-xs text-muted-foreground">{user.email}</p>
          <button onClick={signOut} className="mt-2 flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
            <LogOut className="h-4 w-4" />Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-sidebar p-3 md:hidden">
          <img src={logo.url} alt="Frontier Tower Associates Philippines" className="w-32" />
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>
        {menuOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-foreground/40"
            />
            <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar p-4 shadow-lg">
              <div className="flex items-center justify-between">
                <img src={logo.url} alt="Frontier Tower Associates Philippines" className="w-36 px-2" />
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                  className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="mt-6 flex-1 space-y-1">
                {items.map(({ to, label, icon: Icon }) => (
                  <Link key={to} to={to}
                    className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    activeProps={{ className: "bg-sidebar-accent text-primary" }}>
                    <Icon className="h-4 w-4" />{label}
                  </Link>
                ))}
              </nav>
              <HelperStatus className="px-2" />
              <div className="mt-4 border-t border-sidebar-border pt-4">
                <p className="truncate px-2 text-xs text-muted-foreground">{user.email}</p>
                <button onClick={signOut} className="mt-2 flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
                  <LogOut className="h-4 w-4" />Sign out
                </button>
              </div>
            </aside>
          </div>
        )}
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 md:px-10"><Outlet /></main>
      </div>
    </div>
  );
}
