export const PORTS = [80, 443, 8443];
export function parseIp(ip) {
  if (typeof ip !== "string" || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return null;
  const parts = ip.split(".");
  if (parts.some((p) => String(Number(p)) !== p || Number(p) > 255)) return null;
  return parts.reduce((value, p) => (value * 256 + Number(p)) >>> 0, 0);
}
export function privateIp(ip) {
  if (parseIp(ip) === null) return false;
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export function parseCidrs(value) {
  const entries = value.split(",").map((entry) => entry.trim());
  if (!entries.length) throw new Error("ALLOWED_CIDRS is required");
  return entries.map((entry) => {
    const [ip, bits, extra] = entry.split("/");
    const base = parseIp(ip), prefix = Number(bits);
    if (base === null || bits === undefined || !/^\d+$/.test(bits) || prefix < 0 || prefix > 32 || extra !== undefined) throw new Error("Invalid ALLOWED_CIDRS");
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const network = (base & mask) >>> 0;
    const end = (network | (~mask >>> 0)) >>> 0;
    const asIp = (n) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");
    if (!privateIp(asIp(network)) || !privateIp(asIp(end))) throw new Error("Allow only RFC1918 router CIDRs");
    return { network, mask };
  });
}
export function allowedTarget(ip, port, cidrs) {
  const value = parseIp(ip);
  return privateIp(ip) && PORTS.includes(port) && value !== null && cidrs.some(({ network, mask }) => ((value & mask) >>> 0) === network);
}
export function allowedRequest(raw, ip) {
  try {
    const url = new URL(raw);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return url.hostname === ip && !url.username && !url.password && PORTS.includes(port) && url.protocol === (port === 80 ? "http:" : "https:");
  } catch { return false; }
}