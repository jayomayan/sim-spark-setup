import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { captureInputSchema, captureResultSchema } from "@/lib/private-browser";

export const captureRouterPort = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ip: string; port: number }) => captureInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: member, error } = await context.supabase.rpc("is_member", { _user_id: context.userId });
    if (error || !member) throw new Error("Operational access is required.");
    const endpoint = process.env["PRIVATE_BROWSER_SERVICE_URL"];
    const token = process.env["PRIVATE_BROWSER_SERVICE_TOKEN"];
    if (!endpoint || !token) return { capture: null, error: "The screenshot service is not connected yet." };
    let url: URL;
    try {
      url = new URL(endpoint);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      return { capture: null, error: "The screenshot service needs a valid HTTPS address." };
    }
    try {
      const response = await fetch(`${url.href.replace(/\/$/, "")}/capture`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(35_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        return { capture: null, error: response.status === 429 ? "Screenshot service is busy. Please try again." : response.status === 403 ? "This IP is outside the screenshot service’s allowed router ranges." : "The screenshot service could not complete the request. Check its connection and key." };
      }
      const text = await response.text();
      if (text.length > 3_100_000) throw new Error("Oversized response");
      const capture = captureResultSchema.parse(JSON.parse(text));
      if (capture.port !== data.port) throw new Error("Unexpected port");
      return { capture, error: null };
    } catch {
      return { capture: null, error: "Could not reach the screenshot service. Check that it is running and reachable." };
    }
  });