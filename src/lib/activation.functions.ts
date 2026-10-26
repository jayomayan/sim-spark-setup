import { createServerFn } from "@tanstack/react-start";

// Fixed router template applied to every UR35.
export const FIREWALL_RULES = [
  { name: "Allow HTTPS mgmt", action: "accept", protocol: "tcp", port: 443 },
  { name: "Allow SSH mgmt", action: "accept", protocol: "tcp", port: 22 },
  { name: "Drop WAN HTTP", action: "drop", protocol: "tcp", port: 80 },
  { name: "Drop all other inbound", action: "drop", protocol: "any", port: 0 },
];
export const NTP_SETTINGS = {
  enabled: true,
  servers: ["pool.ntp.org", "time.google.com"],
  timezone: "Asia/Manila",
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const validIccid = (s: string) => /^\d{18,22}$/.test(s);

function iotConfig() {
  const base = process.env["IOT_CC_BASE_URL"];
  const user = process.env["IOT_CC_USERNAME"];
  const pass = process.env["IOT_CC_PASSWORD"];
  if (!base || !user || !pass) return null;
  return { base: base.replace(/\/$/, ""), auth: "Basic " + btoa(`${user}:${pass}`) };
}

function routerConfig() {
  const user = process.env["UR35_USERNAME"];
  const pass = process.env["UR35_PASSWORD"];
  if (!user || !pass) return null;
  return { auth: "Basic " + btoa(`${user}:${pass}`) };
}

export const activateSim = createServerFn({ method: "POST" })
  .inputValidator((d: { iccid: string }) => {
    if (!validIccid(d.iccid)) throw new Error("ICCID must be 18–22 digits");
    return d;
  })
  .handler(async ({ data }) => {
    const cfg = iotConfig();
    if (!cfg) {
      await wait(1200);
      return { ok: true, simulated: true };
    }
    const res = await fetch(`${cfg.base}/devices/${data.iccid}`, {
      method: "PUT",
      headers: { Authorization: cfg.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVATED" }),
    });
    if (!res.ok) throw new Error(`Activation failed (${res.status})`);
    return { ok: true, simulated: false };
  });

export const getSimIp = createServerFn({ method: "POST" })
  .inputValidator((d: { iccid: string; attempt: number }) => d)
  .handler(async ({ data }) => {
    const cfg = iotConfig();
    if (!cfg) {
      await wait(800);
      if (data.attempt < 3) return { ip: null as string | null, status: "PENDING" };
      const n = Number(data.iccid.slice(-4)) || 1;
      return { ip: `10.${(n >> 8) % 255}.${n % 255}.${(data.attempt * 7) % 250 + 2}`, status: "ACTIVE" };
    }
    const res = await fetch(`${cfg.base}/devices/${data.iccid}`, {
      headers: { Authorization: cfg.auth, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Status lookup failed (${res.status})`);
    const j = (await res.json()) as { status?: string; fixedIPAddress?: string; ipAddress?: string };
    return { ip: j.fixedIPAddress || j.ipAddress || null, status: j.status ?? "UNKNOWN" };
  });

async function pushToRouter(ip: string, path: string, body: unknown) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error("Invalid IP address");
  const cfg = routerConfig();
  if (!cfg) {
    await wait(1500);
    return { ok: true, simulated: true };
  }
  const res = await fetch(`https://${ip}${path}`, {
    method: "POST",
    headers: { Authorization: cfg.auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Router rejected settings (${res.status})`);
  return { ok: true, simulated: false };
}

export const applyFirewall = createServerFn({ method: "POST" })
  .inputValidator((d: { ip: string }) => d)
  .handler(({ data }) => pushToRouter(data.ip, "/api/firewall/rules", { rules: FIREWALL_RULES }));

export const applyNtp = createServerFn({ method: "POST" })
  .inputValidator((d: { ip: string }) => d)
  .handler(({ data }) => pushToRouter(data.ip, "/api/system/ntp", NTP_SETTINGS));
