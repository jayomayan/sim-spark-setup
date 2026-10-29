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
export function routerUrl(ip: string, port: BrowserPort): string {
  routerIpSchema.parse(ip);
  return `${port === 80 ? "http" : "https"}://${ip}:${port}`;
}