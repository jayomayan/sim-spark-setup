import { z } from "zod";

export const BROWSER_PORTS = [80, 443, 8443] as const;
export type BrowserPort = (typeof BROWSER_PORTS)[number];
export function isRouterIp(ip: string): boolean {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
  const parts = ip.split(".");
  if (parts.some((part) => String(Number(part)) !== part || Number(part) > 255)) return false;
  const a = Number(parts[0]), b = Number(parts[1]);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export const routerIpSchema = z.string().refine(isRouterIp, "Enter a private router IP address.");
export const captureInputSchema = z.object({ ip: routerIpSchema, port: z.union([z.literal(80), z.literal(443), z.literal(8443)]) }).strict();
export const captureResultSchema = z.object({
  port: z.union([z.literal(80), z.literal(443), z.literal(8443)]),
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
export function routerUrl(ip: string, port: BrowserPort): string {
  routerIpSchema.parse(ip);
  return `${port === 80 ? "http" : "https"}://${ip}:${port}`;
}