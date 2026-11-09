import { createFileRoute } from "@tanstack/react-router";
import { JOB_TYPES, isSupportedJobType } from "@/lib/job-types";
import { routerProgressSchema } from "@/lib/router-progress";

// Endpoint used by the on-network helper. The helper key is created in Admin Settings;
// an AGENT_TOKEN secret still works as a fallback for machines installed the old way.
async function authorized(request: Request) {
  const got = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!got) return false;
  if (process.env["AGENT_TOKEN"] && process.env["AGENT_TOKEN"] === got) return true;
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { matchesHelperToken } = await import("@/lib/helper-settings.server");
  return matchesHelperToken(db, got);
}

export const Route = createFileRoute("/api/public/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorized(request))) return new Response("Unauthorized", { status: 401 });
        const body = (await request.json().catch(() => null)) as
          | { action: "poll"; version?: string; hostname?: string; claimJobs?: boolean }
          | { action: "result"; id: string; ok: boolean; result?: unknown; error?: string }
          | { action: "progress"; id: string; progress?: unknown }
          | null;
        if (!body) return new Response("Bad request", { status: 400 });
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

        if (body.action === "poll") {
          const [{ HELPER_VERSION }, { helperConfigVersion }] = await Promise.all([
            import("@/lib/helper-release"),
            import("@/lib/helper-settings.server"),
          ]);
          // Tells the helper which release to move to and when its saved settings changed.
          const release = { latestVersion: HELPER_VERSION, configVersion: await helperConfigVersion(db) };
          await db.from("agent_status").update({
            last_seen: new Date().toISOString(),
            version: String(body.version ?? "").slice(0, 40),
            hostname: String(body.hostname ?? "").slice(0, 120),
          }).eq("id", 1);
          // Busy-helper check-ins never claim a second task or expire active work.
          if (body.claimJobs === false) return Response.json({ job: null, ...release });
          // Fail jobs a helper picked up but never finished.
          await db.from("agent_jobs").update({ status: "failed", error: "Helper stopped before finishing" })
            .eq("status", "running").lt("started_at", new Date(Date.now() - 10 * 60_000).toISOString());
          const { data: next } = await db.from("agent_jobs").select("id,type,payload")
            .eq("status", "queued").in("type", [...JOB_TYPES]).order("created_at").limit(1).maybeSingle();
          if (!next) return Response.json({ job: null, ...release });
          const { data: claimed } = await db.from("agent_jobs")
            .update({ status: "running", started_at: new Date().toISOString() })
            .eq("id", next.id).eq("status", "queued").select("id").maybeSingle();
          return Response.json({ job: claimed ? next : null, ...release });
        }

        if (body.action === "progress" && typeof body.id === "string") {
          const parsed = routerProgressSchema.safeParse(body);
          if (!parsed.success) return new Response("Invalid progress", { status: 400 });
          const { data: job } = await db.from("agent_jobs").select("type,status").eq("id", body.id).maybeSingle();
          if (!job || job.type !== "ur35_firewall" || job.status !== "running") return new Response("Job is not running", { status: 409 });
          const { error } = await db.from("agent_jobs").update({ result: parsed.data as never })
            .eq("id", body.id).eq("status", "running");
          if (error) return new Response("Progress update failed", { status: 500 });
          return Response.json({ ok: true });
        }

        if (body.action === "result" && typeof body.id === "string") {
          const { data: job } = await db.from("agent_jobs").select("type,payload").eq("id", body.id).maybeSingle();
          if (!job) return new Response("Unknown job", { status: 404 });
          if (!isSupportedJobType(job.type)) return new Response("Unsupported job", { status: 410 });
          const result = body.result ?? null;
          await db.from("agent_jobs").update({
            status: body.ok ? "done" : "failed",
            ...(body.ok || body.result !== undefined ? { result: result as never } : {}),
            error: body.ok ? null : String(body.error ?? "Failed").slice(0, 2000),
            finished_at: new Date().toISOString(),
          }).eq("id", body.id);
          return Response.json({ ok: true });
        }
        return new Response("Bad request", { status: 400 });
      },
    },
  },
});
