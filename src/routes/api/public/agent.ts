import { createFileRoute } from "@tanstack/react-router";

// Endpoint used by the on-network helper. Authenticated with the AGENT_TOKEN shared secret.
function authorized(request: Request) {
  const token = process.env["AGENT_TOKEN"];
  const got = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || got.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

type LogRow = { date: string; time: string; event?: string; message?: string };

export const Route = createFileRoute("/api/public/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
        const body = (await request.json().catch(() => null)) as
          | { action: "poll"; version?: string; hostname?: string }
          | { action: "result"; id: string; ok: boolean; result?: unknown; error?: string }
          | null;
        if (!body) return new Response("Bad request", { status: 400 });
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

        if (body.action === "poll") {
          await db.from("agent_status").update({
            last_seen: new Date().toISOString(),
            version: String(body.version ?? "").slice(0, 40),
            hostname: String(body.hostname ?? "").slice(0, 120),
          }).eq("id", 1);
          // Fail jobs a helper picked up but never finished.
          await db.from("agent_jobs").update({ status: "failed", error: "Helper stopped before finishing" })
            .eq("status", "running").lt("started_at", new Date(Date.now() - 10 * 60_000).toISOString());
          const { data: next } = await db.from("agent_jobs").select("id,type,payload")
            .eq("status", "queued").order("created_at").limit(1).maybeSingle();
          if (!next) return Response.json({ job: null });
          const { data: claimed } = await db.from("agent_jobs")
            .update({ status: "running", started_at: new Date().toISOString() })
            .eq("id", next.id).eq("status", "queued").select("id").maybeSingle();
          return Response.json({ job: claimed ? next : null });
        }

        if (body.action === "result" && typeof body.id === "string") {
          const { data: job } = await db.from("agent_jobs").select("type,payload").eq("id", body.id).maybeSingle();
          if (!job) return new Response("Unknown job", { status: 404 });
          let result = body.result ?? null;
          if (body.ok && job.type === "pull_logs") {
            const p = job.payload as { ip: string; site_id?: string };
            const logs = ((result as { logs?: LogRow[] })?.logs ?? []).slice(0, 20000);
            const rows = logs.map((l) => ({ ip: p.ip, site_id: p.site_id ?? null, date: l.date, time: l.time, event: l.event ?? null, message: l.message ?? null }));
            for (let i = 0; i < rows.length; i += 1000) {
              await db.from("device_logs").upsert(rows.slice(i, i + 1000), { onConflict: "ip,date,time,message", ignoreDuplicates: true });
            }
            await db.from("devices").update({ last_log_pulled_at: new Date().toISOString() }).eq("ip", p.ip);
            result = { imported: rows.length };
          }
          await db.from("agent_jobs").update({
            status: body.ok ? "done" : "failed",
            result: result as never,
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
