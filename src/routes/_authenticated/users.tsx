import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { setUserRole } from "@/lib/users.functions";
import { PageHeader, meta } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => meta("Users", "Give people access to the console and choose who are admins."),
  component: UsersPage,
});

function UsersPage() {
  const qc = useQueryClient();
  const setRole = useServerFn(setUserRole);
  const { data } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id,email,display_name,created_at").order("created_at"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      return (profiles ?? []).map((p) => ({ ...p, role: roles?.find((r) => r.user_id === p.id)?.role ?? "none" }));
    },
  });

  async function change(userId: string, role: "admin" | "operator" | "none") {
    try {
      await setRole({ data: { userId, role } });
      toast.success("Access updated");
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update access");
    }
  }

  return (
    <>
      <PageHeader kicker="Admin" title="Users" />
      <p className="mb-4 text-sm text-muted-foreground">New sign-ups wait here until you give them access.</p>
      <div className="panel divide-y">
        {data?.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm">{u.email}</p>
              <p className="text-xs text-muted-foreground">{u.display_name}</p>
            </div>
            <Select value={u.role} onValueChange={(v) => change(u.id, v as "admin" | "operator" | "none")}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No access</SelectItem>
                <SelectItem value="operator">Operator</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </>
  );
}
