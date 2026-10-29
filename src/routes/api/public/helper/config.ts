import { createFileRoute } from "@tanstack/react-router";

// The helper's private fetch: router login, firewall template and NTP template.
// Only a caller holding the helper key gets it — it never goes to a browser.
export const Route = createFileRoute("/api/public/helper/config")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const { matchesHelperToken, helperConfig } = await import("@/lib/helper-settings.server");
        if (!(await matchesHelperToken(db, token))) return new Response("Unauthorized", { status: 401 });
        return Response.json(await helperConfig(db));
      },
    },
  },
});
