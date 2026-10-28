#!/usr/bin/env node
// Field Ops Console — network helper.
// Runs on a machine inside your network that can reach the routers.
// It asks the console for work, does it, and reports back. No inbound ports needed.
//
// Setup:
//   1. Install Node.js 18+ and the `snmpwalk` and `ping` tools on this machine.
//   2. Copy the `node-scripts` folder from your old app next to this file
//      (or set NODE_SCRIPTS_DIR to where it lives) and run `npm install` there.
//   3. Set the environment variables below, then run:  node field-ops-helper.mjs
//
// Required:  CONSOLE_URL   e.g. https://your-app.lovable.app
//            AGENT_TOKEN   the helper key you saved in the console
// Optional:  NODE_SCRIPTS_DIR (default ./node-scripts)
//            UR35_USERNAME / UR35_PASSWORD  (UR35 router login)
//            DEVICE_USERNAME / DEVICE_PASSWORD (Enetek/Eltek login, default admin/admin)
//            UR35_FIREWALL_PATH (default /api/firewall/rules), UR35_NTP_PATH (default /api/system/ntp)

import { execFile } from "node:child_process";
import { hostname } from "node:os";
import path from "node:path";
import https from "node:https";

const VERSION = "1.0.0";
const URL_BASE = (process.env.CONSOLE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.AGENT_TOKEN || "";
const SCRIPTS = path.resolve(process.env.NODE_SCRIPTS_DIR || "./node-scripts");
if (!URL_BASE || !TOKEN) {
  console.error("Set CONSOLE_URL and AGENT_TOKEN first.");
  process.exit(1);
}

// Fixed UR35 template applied during SIM activation. Edit to match your standard.
const FIREWALL_RULES = [
  { name: "Allow HTTPS mgmt", action: "accept", protocol: "tcp", port: 443 },
  { name: "Allow SSH mgmt", action: "accept", protocol: "tcp", port: 22 },
  { name: "Drop WAN HTTP", action: "drop", protocol: "tcp", port: 80 },
  { name: "Drop all other inbound", action: "drop", protocol: "any", port: 0 },
];
const NTP_SETTINGS = { enabled: true, servers: ["pool.ntp.org", "time.google.com"], timezone: "Asia/Manila" };

const IP_RE = /^(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\.[\d.]+$/;
const checkIp = (ip) => {
  if (typeof ip !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || !IP_RE.test(ip)) throw new Error("Invalid private IP");
  return ip;
};

function run(cmd, args, timeout = 120_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: String(stdout) + String(stderr) }));
  });
}

async function api(body) {
  const res = await fetch(`${URL_BASE}/api/public/agent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Console replied ${res.status}`);
  return res.json();
}

function routerPost(ip, p, body) {
  const user = process.env.UR35_USERNAME, pass = process.env.UR35_PASSWORD;
  if (!user || !pass) throw new Error("UR35_USERNAME / UR35_PASSWORD not set on the helper");
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: ip, path: p, method: "POST", rejectUnauthorized: false, timeout: 30_000,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") },
    }, (res) => {
      let txt = ""; res.on("data", (c) => (txt += c));
      res.on("end", () => (res.statusCode < 300 ? resolve({ status: res.statusCode }) : reject(new Error(`Router rejected settings (${res.statusCode})`))));
    });
    req.on("timeout", () => req.destroy(new Error("Router timed out")));
    req.on("error", reject);
    req.end(data);
  });
}

function parseLogCsv(text) {
  const logs = [];
  for (const line of text.trim().split("\n").slice(5)) {
    const parts = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    if (parts.length < 4) continue;
    const d = new Date(parts[1]);
    if (isNaN(d)) continue;
    const pad = (n) => String(n).padStart(2, "0");
    logs.push({
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      event: parts[2], message: parts[3],
    });
  }
  return logs;
}

const handlers = {
  async ping({ ip }) {
    const { code, out } = await run("ping", ["-c", "5", "-W", "2", checkIp(ip)], 30_000);
    const loss = out.match(/(\d+)% packet loss/);
    const rtt = out.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)/);
    return { success: code === 0, raw_output: out.trim().split("\n"), packet_loss: loss ? `${loss[1]}%` : undefined,
      rtt: rtt ? { min: `${rtt[1]} ms`, avg: `${rtt[2]} ms`, max: `${rtt[3]} ms` } : undefined };
  },
  async snmp_walk({ ip, port, community, oids }) {
    const results = [], errors = [];
    for (const oid of (oids || []).slice(0, 20)) {
      if (!/^[.\d]+$/.test(oid)) { errors.push(`Bad OID ${oid}`); continue; }
      const { code, out } = await run("snmpwalk", ["-v2c", "-c", String(community), `${checkIp(ip)}:${Number(port) || 161}`, oid], 60_000);
      if (code !== 0) { errors.push(`SNMP failed for ${oid}`); continue; }
      for (const line of out.split("\n")) {
        const i = line.indexOf(" = ");
        if (i > 0) results.push({ oid: line.slice(0, i).trim(), value: line.slice(i + 3).trim() });
      }
    }
    return { results, errors };
  },
  async device_ntp({ ip, brand }) {
    const { code, out } = await run("node", [path.join(SCRIPTS, "setclock.cjs"), checkIp(ip), String(brand || "enetek")]);
    if (code !== 0) throw new Error(out.trim().slice(-500) || `Script exited with code ${code}`);
    return { ok: true };
  },
  async ur35_firewall({ ip }) {
    return routerPost(checkIp(ip), process.env.UR35_FIREWALL_PATH || "/api/firewall/rules", { rules: FIREWALL_RULES });
  },
  async ur35_ntp({ ip }) {
    return routerPost(checkIp(ip), process.env.UR35_NTP_PATH || "/api/system/ntp", NTP_SETTINGS);
  },
  async pull_logs({ ip, brand }) {
    const script = String(brand).toLowerCase() === "eltek" ? "download-logs-eltek.cjs" : "download-logs.cjs";
    const { code, out } = await run("node", [path.join(SCRIPTS, script), checkIp(ip),
      process.env.DEVICE_USERNAME || "admin", process.env.DEVICE_PASSWORD || "admin"], 300_000);
    if (code !== 0) throw new Error(out.trim().slice(-500) || "Log download failed");
    return { logs: parseLogCsv(out) };
  },
};

async function loop() {
  console.log(`Field Ops helper ${VERSION} → ${URL_BASE}`);
  for (;;) {
    try {
      const { job } = await api({ action: "poll", version: VERSION, hostname: hostname() });
      if (!job) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      console.log(`→ ${job.type}`, job.payload);
      try {
        const fn = handlers[job.type];
        if (!fn) throw new Error(`Unknown job type ${job.type}`);
        const result = await fn(job.payload || {});
        await api({ action: "result", id: job.id, ok: true, result });
        console.log(`✓ ${job.type}`);
      } catch (e) {
        await api({ action: "result", id: job.id, ok: false, error: String(e?.message || e) });
        console.log(`✗ ${job.type}: ${e?.message || e}`);
      }
    } catch (e) {
      console.error("Can't reach console:", e?.message || e);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}
loop();
