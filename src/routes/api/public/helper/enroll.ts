import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// A fresh machine trades its one-time install code for the helper key.
// Codes are single-use and expire, so a leaked command line is only dangerous for minutes.
const input = z.object({ code: z.string().min(16).max(200) });

export const Route = createFileRoute("/api/public/helper/enroll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = input.safeParse(await request.json().catch(() => null));
        if (!body.success) return new Response("Bad request", { status: 400 });
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const { redeemEnrollment } = await import("@/lib/helper-settings.server");
        const token = await redeemEnrollment(db, body.data.code);
        if (!token) return new Response("This install code is not valid, has already been used, or has expired.", { status: 403 });
        return Response.json({ token });
      },
    },
  },
});
