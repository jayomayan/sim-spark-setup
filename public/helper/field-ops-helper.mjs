#!/usr/bin/env node
// Field Ops Console — network helper.
// Runs on a machine inside your network that can reach the routers.
// It asks the console for work, does it, and reports back. No inbound ports needed.
//
// Setup (recommended): Admin Settings → Network Helper → "Create install command",
// then paste that one command on this machine. It installs everything, saves the key
// and starts the helper as a service. Newer releases are downloaded by the helper
// itself, so there is nothing to reinstall later.
//
// Setup (by hand): install Node.js 18+, `snmpwalk` and `ping`, run `npm install`
// and `npx playwright install chromium` next to this file, then start it with:
//   CONSOLE_URL=https://your-console AGENT_TOKEN=<helper key> node field-ops-helper.mjs
//
// The router login and the firewall/NTP templates normally live in Admin Settings;
// UR35_USERNAME, UR35_PASSWORD, UR35_FIREWALL_PATH and UR35_NTP_PATH are used only
// if the console can't be reached.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import https from "node:https";
import { createCipheriv, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const VERSION = "1.9.3";
const URL_BASE = (process.env.CONSOLE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.AGENT_TOKEN || "";
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
process.env.FIELD_OPS_HELPER_DIR = SELF_DIR;
let sshModule;
async function configureRouter(...args) {
  if (!sshModule) {
    const modulePath = path.join(SELF_DIR, "router-ssh.mjs");
    try { await fs.access(modulePath); } catch {
      // Pre-1.9 helpers only download the entry file and package during self-update.
      const response = await fetch(`${URL_BASE}/helper/router-ssh.mjs`, { redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Could not download the router SSH module; no settings were sent");
      const temp = `${modulePath}.${process.pid}.tmp.mjs`;
      await fs.writeFile(temp, await response.text(), { flag: "wx", mode: 0o600 });
      const check = await run(process.execPath, ["--check", temp], 20_000);
      if (check.code !== 0) { await fs.rm(temp, { force: true }); throw new Error("Router SSH module failed syntax check; no settings were sent"); }
      await fs.rename(temp, modulePath);
    }
    sshModule = await import("./router-ssh.mjs");
  }
  return sshModule.configureRouter(...args);
}
if (!URL_BASE || !TOKEN) {
  console.error("Set CONSOLE_URL and AGENT_TOKEN first.");
  process.exit(1);
}

// Used only when the console can't be reached; Admin Settings is the real source.
const FALLBACK_RULES = [
  { rule: "allow tcp/443", description: "Allow HTTPS management" },
  { rule: "allow tcp/22", description: "Allow SSH management" },
  { rule: "drop tcp/80", description: "Drop WAN HTTP" },
  { rule: "drop any/0", description: "Drop all other inbound" },
];
const FALLBACK_NTP = { enabled: true, servers: ["pool.ntp.org", "time.google.com"], timezone: "Asia/Manila" };

// Router login, firewall template and NTP template are stored in Admin Settings and
// pulled over the same authenticated link the helper already uses.
let config = {
  configVersion: 0,
  ur35Username: "",
  ur35Password: "",
  routerLogins: null,
  ur35FirewallPath: "",
  ur35NtpPath: "",
  firewallRules: FALLBACK_RULES,
  ntp: FALLBACK_NTP,
};

async function writeRouterCredentials(logins) {
  const lines = logins.map(({ username, password }) => {
    if (typeof username !== "string" || !username || /\s/.test(username) ||
        typeof password !== "string" || !password || /[\r\n]/.test(password)) {
      throw new Error("Router logins need a username without spaces and a password without line breaks.");
    }
    return `${username} ${password}\n`;
  }).join("");
  const target = path.join(SELF_DIR, "UR35_Credentials.txt");
  const temp = `${target}.${process.pid}.tmp`;
  let file;
  try {
    // Exclusive creation refuses symlinks; permissions are set before any secret is written.
    file = await fs.open(temp, "wx", 0o600);
    await file.chmod(0o600);
    await file.writeFile(lines, "utf8");
    await file.sync();
    await file.close();
    file = undefined;
    await fs.rename(temp, target);
  } finally {
    if (file) await file.close();
    await fs.unlink(temp).catch(() => {});
  }
}

async function loadConfig() {
  const res = await fetch(`${URL_BASE}/api/public/helper/config`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Settings fetch failed (${res.status})`);
  const body = await res.json();
  const next = {
    configVersion: Number(body.configVersion) || 0,
    ur35Username: String(body.ur35Username || ""),
    ur35Password: String(body.ur35Password || ""),
    routerLogins: Array.isArray(body.routerLogins) ? body.routerLogins : null,
    ur35FirewallPath: String(body.ur35FirewallPath || ""),
    ur35NtpPath: String(body.ur35NtpPath || ""),
    firewallRules: Array.isArray(body.firewallRules) && body.firewallRules.length ? body.firewallRules : FALLBACK_RULES,
    ntp: body.ntp && typeof body.ntp === "object" ? body.ntp : FALLBACK_NTP,
  };
  await writeRouterCredentials(next.routerLogins ?? (next.ur35Username ? [{ username: next.ur35Username, password: next.ur35Password }] : []));
  config = next;
}

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

// Milesight UR-series /cgi API. Never log response bodies, passwords or session tokens.
// AES constants match the published router-family login.js; unsupported firmware stops here.
function encryptRouterPassword(password) {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from("1111111111111111"), Buffer.from("2222222222222222"));
  return Buffer.concat([cipher.update(Buffer.from(password, "utf8")), cipher.final()]).toString("base64");
}

function routerRequest(ip, body, token, port = 443) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) };
    if (token) headers["x-session-id"] = token;
    const req = https.request({ host: ip, port, path: "/cgi", method: "POST", rejectUnauthorized: false, timeout: 30_000, headers }, (res) => {
      let txt = "";
      res.on("data", (chunk) => {
        txt += chunk;
        if (txt.length > 1024 * 1024) req.destroy(new Error("Router response too large"));
      });
      res.on("end", () => {
        if (res.statusCode !== 200) { reject(new Error(`Router HTTPS request rejected (${res.statusCode})`)); return; }
        try { resolve(JSON.parse(txt)); } catch { reject(new Error("Router does not support the expected Milesight HTTPS API")); }
      });
      res.on("error", () => reject(new Error("Router response interrupted")));
    });
    req.on("timeout", () => req.destroy(new Error("Router timed out")));
    req.on("error", (cause) => {
      const error = new Error(`Router HTTPS connection failed or timed out on port ${port}`);
      // Only transport failures before an HTTP response permit login on another port.
      error.routerConnectionFailure = ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPROTO"].includes(cause?.code) || cause?.message === "Router timed out";
      reject(error);
    });
    req.end(data);
  });
}

async function routerLogin(ip) {
  const logins = config.routerLogins ?? [{
    username: config.ur35Username || process.env.UR35_USERNAME || "",
    password: config.ur35Password || process.env.UR35_PASSWORD || "",
  }];
  if (!logins.length || logins.some((login) => !login.username || !login.password)) {
    throw new Error("Router login isn't set — enter it in Admin Settings → Network Helper.");
  }
  for (const port of [443, 8443]) {
    try {
      for (const login of logins) {
        const result = await routerRequest(ip, { id: "1", execute: 1, core: "user", function: "login",
          values: [{ username: login.username, password: encryptRouterPassword(login.password) }] }, undefined, port);
        if (result.status === 0) {
          const session = result.result?.[0];
          if (typeof session?.td !== "string" || !session.td || session.ysrole !== 1) throw new Error("Router login needs a supported read-write API account");
          return { token: session.td, port };
        }
        // Only documented incorrect credentials justify another login, never restricted accounts.
        if (result.status !== -1) throw new Error("Router login restricted or unsupported; no settings were sent");
      }
      throw new Error("Router rejected all saved logins.");
    } catch (error) {
      if (!error?.routerConnectionFailure) throw error;
      if (port === 8443) throw new Error("Router HTTPS connection failed or timed out on both ports 443 and 8443; no settings were sent");
    }
  }
}

async function routerCall(ip, token, body) {
  // Pin every read/write/apply to the port that issued the session. Never replay writes.
  const result = await routerRequest(ip, body, token.token, token.port);
  if (result.status !== 0 || result.result?.some((entry) => entry.templet_code || entry.error ||
      (entry.code && entry.code !== 10000000))) throw new Error("Router rejected configuration or session expired; check the router before retrying");
  return result;
}

function routerConfig(result, type) {
  const entries = result.result?.flatMap((entry) => entry.get ?? []);
  const found = entries?.filter((entry) => entry.type === type);
  if (found?.length !== 1 || found[0].index === undefined || !found[0].value || typeof found[0].value !== "object") {
    throw new Error("Unsupported router configuration response; no changes were sent");
  }
  return found[0];
}

function convertFirewallRules(rules) {
  if (!Array.isArray(rules) || !rules.length) throw new Error("Enter custom firewall commands in Admin Settings first");
  const ids = new Set();
  return rules.map(({ rule, description }) => {
    const match = String(rule).trim().match(/^firewall\s+access-control\s+custom\s+id\s+(\S+)\s+rule\s+(.+)$/);
    const id = match?.[1] ?? randomUUID().replaceAll("-", "");
    let command = match?.[2] ?? String(rule).trim();
    if (!/^(-t\s+(filter|nat|mangle|raw)\s+)?-(I|A)\s+(INPUT|OUTPUT|FORWARD|POSTROUTING|PREROUTING)\b/.test(command) || /[\r\n\x00]/.test(command)) {
      throw new Error("Use a Milesight custom firewall CLI command or an iptables rule starting with -I, -A or -t");
    }
    // iptables defaults to filter; POSTROUTING/PREROUTING MASQUERADE needs the NAT table.
    if (!command.startsWith("-t ") && /-(I|A)\s+(POSTROUTING|PREROUTING)\b/.test(command)) command = `-t nat ${command}`;
    if (command.length > 255 || String(description ?? "").length > 63 || ids.has(id)) throw new Error("Firewall rules exceed router limits or contain duplicate IDs");
    ids.add(id);
    return { id, rule: command, desc: description ?? "" };
  });
}

function mergeFirewallRules(existing, requested) {
  if (!Array.isArray(existing) || existing.some((entry) => typeof entry.id !== "string" || typeof entry.rule !== "string")) throw new Error("Unsupported existing firewall rules; no changes were sent");
  // Never overwrite an unrelated rule using the same identifier.
  const merged = [...existing];
  for (const rule of requested) {
    const same = merged.find((entry) => entry.id === rule.id);
    if (same && same.rule !== rule.rule) throw new Error("A firewall rule ID conflicts with an existing rule; review the router before changing it");
    if (!merged.some((entry) => entry.rule === rule.rule)) merged.push(rule);
  }
  if (merged.length > 64) throw new Error("Router supports at most 64 custom firewall rules");
  return merged;
}

async function applyRouter(ip, token) {
  const applied = await routerCall(ip, token, { core: "yruo_apply", function: "apply", values: [] });
  const state = applied.result?.[0];
  if (!state || ![0, 1].includes(state.reboot) || ![0, 1].includes(state.reconnect)) throw new Error("Router apply result is unsupported; verify settings on the router");
  if (state.reboot === 1) throw new Error("Router settings saved; a manual router reboot is required before completion");
  if (state.reconnect === 1) throw new Error("Router settings applied; reconnect and verify the router before completion");
}

async function applyFirewall(ip, rules) {
  const requested = convertFirewallRules(rules);
  const token = await routerLogin(ip);
  const query = { id: 2, function: "get", core: "yruo_firewall_custom", values: [{ base: "yruo_firewall_custom" }] };
  const current = routerConfig(await routerCall(ip, token, query), "yruo_firewall_custom");
  const list = mergeFirewallRules(current.value.list, requested);
  if (list.length !== current.value.list.length) {
    await routerCall(ip, token, { id: 3, function: "set", core: "yruo_firewall_custom", values: [{
      base: "yruo_firewall_custom", type: current.type, index: current.index, value: { ...current.value, list },
    }] });
    await applyRouter(ip, token);
  }
  const saved = routerConfig(await routerCall(ip, token, query), "yruo_firewall_custom");
  if (!Array.isArray(saved.value.list) || list.some((rule) => !saved.value.list.some((entry) => entry.id === rule.id && entry.rule === rule.rule))) throw new Error("Firewall configuration verification failed; check the router before retrying");
  return { status: 200, verified: true, rules: requested.length };
}

async function applyNtp(ip, ntp) {
  if (!ntp?.enabled || !Array.isArray(ntp.servers) || ntp.servers.length < 1 || ntp.servers.length > 2 || ntp.servers.some((server) => typeof server !== "string" || !/^[a-zA-Z0-9._:-]+$/.test(server) || server.length > 256)) throw new Error("NTP requires enabled mode and one or two server addresses");
  const token = await routerLogin(ip);
  const query = { id: 4, function: "get", core: "yruo_system", values: [{ base: "time" }] };
  const current = routerConfig(await routerCall(ip, token, query), "time");
  // Preserve firmware-specific timezone formatting unless the supported Manila mapping is selected.
  const timezone = ntp.timezone === "Asia/Manila" ? "UTC+8 Asia/Manila" : current.value.timezone;
  if (ntp.timezone !== "Asia/Manila" && typeof timezone === "string" && !timezone.endsWith(` ${ntp.timezone}`)) throw new Error("Set the requested timezone on the router first; its firmware-specific timezone mapping is unknown");
  const value = { timezone, timezone_type: ntp.timezone === "Asia/Manila" ? 0 : current.value.timezone_type,
    set_type: 0, ntp_enable: 1, ntp_address: ntp.servers[0], ntp_address_secondary: ntp.servers[1] ?? "",
    update_interval: current.value.update_interval, ntp_master: current.value.ntp_master };
  if (typeof value.timezone !== "string" || ![0, 1].includes(value.timezone_type) || !Number.isInteger(value.update_interval) || ![0, 1].includes(value.ntp_master)) throw new Error("Unsupported router NTP settings; no changes were sent");
  await routerCall(ip, token, { id: 5, function: "set", core: "yruo_system", values: [{ base: "time", type: "time", index: current.index, value }] });
  await applyRouter(ip, token);
  const saved = routerConfig(await routerCall(ip, token, query), "time");
  if (Object.entries(value).some(([key, expected]) => saved.value[key] !== expected)) throw new Error("NTP configuration verification failed; check the router before retrying");
  return { status: 200, verified: true };
}

// --- Site Connectivity Check: port screenshots + ping, run on this machine ---
// Devices answer on either protocol on port 8080, so both are tried there.
const SITE_PORTS = { 80: ["http"], 443: ["https"], 8443: ["https"], 8080: ["http", "https"] };
let browser = null;
async function getBrowser() {
  if (browser?.isConnected()) return browser;
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("Screenshots need the helper dependencies: run `npm install` then `npx playwright install chromium` next to this file.");
  }
  browser = await chromium.launch({ headless: true, args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-quic"] });
  return browser;
}
// Only requests back to the very same router IP on a checked port may leave the browser.
const sameTarget = (raw, ip) => {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    return u.hostname === ip && Object.prototype.hasOwnProperty.call(SITE_PORTS, port);
  } catch { return false; }
};

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
  async ur35_firewall({ ip }) {
    return configureRouter(checkIp(ip), config.routerLogins ?? [{ username: config.ur35Username, password: config.ur35Password }], "firewall", config.firewallRules);
  },
  async ur35_ntp({ ip }) {
    return configureRouter(checkIp(ip), config.routerLogins ?? [{ username: config.ur35Username, password: config.ur35Password }], "ntp", config.ntp);
  },
  async site_ping({ ip }) {
    // With both -c and -w, Linux ping may keep sending until four replies arrive.
    // Bound execution with execFile's timeout instead, keeping exactly four probes.
    const { out } = await run("ping", ["-n", "-c", "4", "-W", "2", checkIp(ip)], 15_000);
    const packets = out.match(/(\d+) packets transmitted,\s*(\d+) (?:packets )?received,.*?([\d.]+)% packet loss/);
    if (!packets) throw new Error("Ping returned an unreadable result. Check ping is installed on this machine.");
    const transmitted = Number(packets[1]), received = Number(packets[2]);
    if (transmitted !== 4 || received > transmitted) throw new Error("Unexpected ping result.");
    const timing = out.match(/(?:rtt|round-trip)[^=]*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/);
    return {
      reachable: received > 0, transmitted, received,
      packetLoss: (transmitted - received) / transmitted * 100,
      minMs: timing ? Number(timing[1]) : null,
      avgMs: timing ? Number(timing[2]) : null,
      maxMs: timing ? Number(timing[3]) : null,
    };
  },
  async site_capture({ ip, port }) {
    port = Number(port);
    if (!Object.prototype.hasOwnProperty.call(SITE_PORTS, port)) throw new Error("Unsupported port");
    const target = checkIp(ip);
    const context = await (await getBrowser()).newContext({ viewport: { width: 1024, height: 768 }, ignoreHTTPSErrors: true, serviceWorkers: "block", acceptDownloads: false });
    try {
      await context.route("**/*", (route) => (sameTarget(route.request().url(), target) ? route.continue() : route.abort()));
      await context.routeWebSocket("**/*", (socket) => socket.close());
      let httpStatus = null;
      for (const scheme of SITE_PORTS[port]) {
        const page = await context.newPage();
        page.on("popup", (popup) => void popup.close());
        page.on("dialog", (dialog) => void dialog.dismiss());
        page.on("download", (download) => void download.cancel());
        try {
          const response = await page.goto(`${scheme}://${target}:${port}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
          httpStatus = response?.status() ?? null;
          // Login/forbidden pages are browsable; a responding HTTP server is accessible.
          if (response !== null && sameTarget(page.url(), target)) {
            await page.waitForTimeout(1000);
            const image = await page.screenshot({ type: "jpeg", quality: 70, timeout: 5000, animations: "disabled" });
            return { port, accessible: true, httpStatus, screenshot: `data:image/jpeg;base64,${image.toString("base64")}` };
          }
        } catch (error) {
          // A filtered port answers no protocol, so a timeout needs no further attempt.
          if (error?.name === "TimeoutError") break;
        }
        await page.close();
      }
      const page = await context.newPage();
      await page.setContent(`<html><head><style>body{margin:0;background:#fff;color:#303030;font-family:Arial,sans-serif;display:grid;place-items:center;height:100vh}.message{text-align:center}h1{font-size:32px;color:#B0262D}p{font-size:20px;color:#686868}</style></head><body><div class="message"><h1>Not able to access Port ${port}</h1><p>${target}</p></div></body></html>`);
      const image = await page.screenshot({ type: "jpeg", quality: 70, timeout: 5000, animations: "disabled" });
      return { port, accessible: false, httpStatus, screenshot: `data:image/jpeg;base64,${image.toString("base64")}` };
    } finally { await context.close(); }
  },
};

// --- Self-update: the console serves the release, so no machine is ever patched by hand ---
let updateTried = false;
async function selfUpdate(target) {
  console.log(`Updating helper ${VERSION} → ${target}`);
  const downloaded = new Map();
  for (const name of ["field-ops-helper.mjs", "router-ssh.mjs", "package.json"]) {
    const res = await fetch(`${URL_BASE}/helper/${name}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Couldn't download ${name} (${res.status})`);
    downloaded.set(name, await res.text());
  }
  const next = downloaded.get("field-ops-helper.mjs");
  if (!next.includes(`const VERSION = "${target}"`)) throw new Error("Downloaded file didn't match the advertised release");
  const temp = path.join(SELF_DIR, `.update-${target}.mjs`);
  await fs.writeFile(temp, next, "utf8");
  const check = await run(process.execPath, ["--check", temp], 20_000);
  if (check.code !== 0) {
    await fs.rm(temp, { force: true });
    throw new Error("Downloaded file failed a syntax check");
  }

  // Dependencies first: a failed install must leave the running release untouched.
  const packageJson = downloaded.get("package.json");
  const currentPackage = await fs.readFile(path.join(SELF_DIR, "package.json"), "utf8").catch(() => "");
  if (packageJson && packageJson !== currentPackage) {
    await fs.writeFile(path.join(SELF_DIR, "package.json"), packageJson, "utf8");
    console.log("Installing new dependencies…");
    const install = await run("npm", ["install", "--prefix", SELF_DIR, "--no-audit", "--no-fund"], 600_000);
    if (install.code !== 0) throw new Error(`Dependency install failed: ${install.out.slice(-400)}`);
    await run("npx", ["--prefix", SELF_DIR, "playwright", "install", "chromium"], 600_000);
  }

  const sshSource = downloaded.get("router-ssh.mjs");
  const sshTemp = path.join(SELF_DIR, `.router-ssh-${target}.mjs`);
  await fs.writeFile(sshTemp, sshSource, "utf8");
  const sshCheck = await run(process.execPath, ["--check", sshTemp], 20_000);
  if (sshCheck.code !== 0) { await fs.rm(sshTemp, { force: true }); throw new Error("SSH module failed a syntax check"); }
  await fs.rename(sshTemp, path.join(SELF_DIR, "router-ssh.mjs"));
  await fs.rename(temp, path.join(SELF_DIR, "field-ops-helper.mjs"));
  console.log(`Updated to ${target}; the service will restart it.`);
  // systemd (Restart=always) or pm2 starts the new file; nothing else to do.
  process.exit(0);
}

async function loop() {
  console.log(`Field Ops helper ${VERSION} → ${URL_BASE}`);
  try {
    await loadConfig();
    console.log(`Settings loaded (revision ${config.configVersion}).`);
  } catch (e) {
    console.error("Couldn't load settings from the console; using saved defaults:", e?.message || e);
  }
  for (;;) {
    try {
      const { job, latestVersion, configVersion } = await api({ action: "poll", version: VERSION, hostname: hostname() });
      if (configVersion && configVersion !== config.configVersion) {
        try {
          await loadConfig();
          console.log(`Settings reloaded (revision ${config.configVersion}).`);
        } catch (e) {
          console.error("Couldn't reload settings:", e?.message || e);
        }
      }
      if (latestVersion && latestVersion !== VERSION && !updateTried) {
        updateTried = true;
        try {
          await selfUpdate(latestVersion);
        } catch (e) {
          console.error("Update failed; staying on", VERSION, "-", e?.message || e);
        }
      }
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
