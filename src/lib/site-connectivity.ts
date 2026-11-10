import { z } from "zod";

export const BROWSER_PORTS = [80, 443, 8443, 8080] as const;
export type BrowserPort = number;
// Devices answer on either protocol on port 8080, so both are tried there.
export const PORT_SCHEMES: Record<BrowserPort, readonly ("http" | "https")[]> = {
  80: ["http"],
  443: ["https"],
  8443: ["https"],
  8080: ["http", "https"],
};
export const portLabel = (port: BrowserPort) => (PORT_SCHEMES[port] ?? ["http"]).map((scheme) => scheme.toUpperCase()).join(" / ");
export const siteTargetSchema = z.object({ port: z.number().int().min(1).max(65535), protocol: z.enum(["http", "https"]) }).strict();
export const siteTargetsSchema = z.array(siteTargetSchema).max(20).refine((targets) => new Set(targets.map(targetKey)).size === targets.length, "Remove duplicate port and protocol entries.");
export type SiteTarget = z.infer<typeof siteTargetSchema>;
export function targetKey(target: SiteTarget): string { return `${target.protocol}:${target.port}`; }
export const DEFAULT_SITE_TARGETS: SiteTarget[] = BROWSER_PORTS.flatMap((port) => PORT_SCHEMES[port].map((protocol) => ({ port, protocol })));
export function isRouterIp(ip: string): boolean {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
  const parts = ip.split(".");
  if (parts.some((part) => String(Number(part)) !== part || Number(part) > 255)) return false;
  const a = Number(parts[0]), b = Number(parts[1]);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export const routerIpSchema = z.string().refine(isRouterIp, "Enter a private router IP address.");
const browserPortSchema = z.number().int().min(1).max(65535);
export const captureInputSchema = z.object({ ip: routerIpSchema, port: browserPortSchema, protocol: z.enum(["http", "https"]).optional() }).strict();
export const captureResultSchema = z.object({
  port: browserPortSchema,
  protocol: z.enum(["http", "https"]).optional(),
  accessible: z.boolean(),
  screenshot: z.string().max(3_000_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
  httpStatus: z.number().int().min(100).max(599).nullable(),
});
export type CaptureResult = z.infer<typeof captureResultSchema>;
export const pingInputSchema = z.object({ ip: routerIpSchema }).strict();
export const pingResultSchema = z.object({
  reachable: z.boolean(),
  transmitted: z.literal(4),
  received: z.number().int().min(0).max(4),
  packetLoss: z.number().min(0).max(100),
  minMs: z.number().finite().nonnegative().nullable(),
  avgMs: z.number().finite().nonnegative().nullable(),
  maxMs: z.number().finite().nonnegative().nullable(),
}).strict().refine((r) => r.reachable === (r.received > 0) && r.packetLoss === (4 - r.received) / 4 * 100 &&
  (r.received === 0 ? r.minMs === null && r.avgMs === null && r.maxMs === null :
    r.minMs !== null && r.avgMs !== null && r.maxMs !== null && r.minMs <= r.avgMs && r.avgMs <= r.maxMs), "Invalid ping statistics");
export type PingResult = z.infer<typeof pingResultSchema>;
export function routerUrl(ip: string, port: BrowserPort, protocol?: SiteTarget["protocol"]): string {
  routerIpSchema.parse(ip);
  browserPortSchema.parse(port);
  return `${protocol ?? PORT_SCHEMES[port]?.[0] ?? "http"}://${ip}:${port}`;
}
