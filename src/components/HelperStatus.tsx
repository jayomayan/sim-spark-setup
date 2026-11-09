import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export function useHelperStatus() {
  return useQuery({
    queryKey: ["agent_status"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data } = await supabase.from("agent_status").select("last_seen,hostname,version").eq("id", 1).maybeSingle();
      const online = !!data?.last_seen && Date.now() - new Date(data.last_seen).getTime() < 60_000;
      return { online, ...data };
    },
  });
}

export function HelperStatus({ className }: { className?: string }) {
  const { data } = useHelperStatus();
  const online = data?.online;
  return (
    <div className={cn("flex items-center gap-2 font-mono text-xs", className)}>
      <span className={cn("h-2 w-2 rounded-full", online ? "bg-primary shadow-[0_0_8px_var(--primary)]" : "bg-destructive")} />
      <span className="text-muted-foreground">{online ? "Helper Online" : "Helper Offline"}</span>
    </div>
  );
}

export function HelperOfflineNote() {
  const { data } = useHelperStatus();
  if (!data || data.online) return null;
  return (
    <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
      The network helper is offline, so router actions will wait until it comes back. See the Helper page to set it up.
    </p>
  );
}
