import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { captureInputSchema, captureResultSchema, pingInputSchema, pingResultSchema } from "@/lib/site-connectivity";

export const captureRouterPort = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ip: string; port: number }) => captureInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: member, error } = await context.supabase.rpc("is_member", { _user_id: context.userId });
    if (error || !member) throw new Error("Operational access is required.");
    const endpoint = process.env["SITE_CONNECTIVITY_SERVICE_URL"];
    const token = process.env["SITE_CONNECTIVITY_SERVICE_TOKEN"];
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

export const pingRouter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ip: string }) => pingInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: member, error } = await context.supabase.rpc("is_member", { _user_id: context.userId });
    if (error || !member) throw new Error("Operational access is required.");
    const endpoint = process.env["SITE_CONNECTIVITY_SERVICE_URL"];
    const token = process.env["SITE_CONNECTIVITY_SERVICE_TOKEN"];
    if (!endpoint || !token) return { ping: null, error: "The connectivity service is not connected yet." };
    let url: URL;
    try {
      url = new URL(endpoint);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { return { ping: null, error: "The connectivity service needs a valid HTTPS address." }; }
    try {
      const response = await fetch(`${url.href.replace(/\/$/, "")}/ping`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) return { ping: null, error: response.status === 429 ? "Ping service is busy. Please try again." : response.status === 403 ? "This IP is outside the service’s allowed router ranges." : response.status === 404 ? "Update the connectivity service to enable ping." : "Ping could not run. Check the service connection, ping installation and ICMP permissions." };
      const text = await response.text();
      if (text.length > 4096) throw new Error("Oversized ping response");
      return { ping: pingResultSchema.parse(JSON.parse(text)), error: null };
    } catch { return { ping: null, error: "Could not reach the ping service. Check that it is running and reachable." }; }
  });