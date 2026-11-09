// UR-series interactive CLI only: never execute router commands in a Linux shell.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const CLI_ERROR = /(?:^|\n)\s*(?:%|error\b|invalid\b|unknown command|unrecognized|permission denied|not permitted|command not found|incomplete command|ambiguous command|failed\b)/i;
const PROMPT = /(?:^|\n)([\w.-]+(?:\([^\r\n]*\))?[>#])\s*$/;

export function firewallCommands(rules) {
  if (!Array.isArray(rules) || !rules.length || rules.length > 50) throw new Error("Enter 1–50 custom firewall commands in Admin Settings");
  const ids = new Set();
  return rules.map(({ rule }) => {
    const command = String(rule).trim();
    const match = command.match(/^firewall access-control custom id ([a-zA-Z0-9_-]+) rule ((?:-t (?:filter|nat|mangle|raw) )?-(?:I|A) (?:INPUT|OUTPUT|FORWARD|POSTROUTING|PREROUTING)\b.+)$/);
    if (!match || /[\r\n\x00;`$|&<>\\]/.test(command) || ids.has(match[1]) || match[2].length > 255) throw new Error("Use original UR35 custom firewall CLI commands with unique IDs; shell commands are not allowed");
    ids.add(match[1]);
    return command;
  });
}

export function ntpCommands(ntp, current) {
  if (!ntp?.enabled || !Array.isArray(ntp.servers) || ntp.servers.length < 1 || ntp.servers.length > 2 || ntp.servers.some((s) => typeof s !== "string" || !/^[a-zA-Z0-9._:-]+$/.test(s) || s.length > 256)) throw new Error("NTP requires enabled mode and one or two server addresses");
  if (ntp.timezone !== "Asia/Manila") throw new Error("SSH NTP conversion currently supports Asia/Manila only");
  const interval = current.match(/^\s*ntp update-interval (\d+)\s*$/m)?.[1];
  if (/^\s*no ntp\s*$/m.test(current) || !interval || Number(interval) < 1 || Number(interval) > 1440) throw new Error("Router NTP must already be enabled with a readable synchronization interval; no settings were sent");
  return ["clock timezone UTC+8", "clock zonename Asia/Manila", `ntp server ${ntp.servers[0]}`,
    ntp.servers[1] ? `ntp secondary-server ${ntp.servers[1]}` : "no ntp secondary-server", `ntp update-interval ${interval}`];
}

function configLines(output) {
  return output.split(/\r?\n/).map((s) => s.trim());
}

// A router that just got its cellular IP often needs a minute or two before SSH answers.
// Retry only failures that happen before any login is sent; nothing is written on the router.
const REACH_RETRY_MS = 180_000, REACH_RETRY_DELAY_MS = 10_000;

export async function configureRouter(ip, logins, kind, settings, connect = connectRouterSsh, timing = {}) {
  const retryMs = timing.retryMs ?? REACH_RETRY_MS, delayMs = timing.delayMs ?? REACH_RETRY_DELAY_MS;
  const sleep = timing.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = timing.now ?? (() => Date.now());
  // Validate all user input before opening a router connection.
  const firewall = kind === "firewall" ? firewallCommands(settings) : null;
  if (!firewall) ntpCommands(settings, "ntp update-interval 60");
  if (!Array.isArray(logins) || !logins.length || logins.some((l) => !l.username || !l.password)) throw new Error("Enter router logins in Admin Settings");
  let session;
  const startedAt = now();
  for (let i = 0; i < logins.length; i++) {
    try { session = await connect(ip, logins[i]); break; }
    catch (error) {
      if (error?.authenticationRejected) continue;
      if (error?.unreachable && now() - startedAt + delayMs <= retryMs) { await sleep(delayMs); i--; continue; }
      if (error?.unreachable) throw new Error(`${error.message} (kept retrying for ${Math.round(retryMs / 60_000)} minutes)`);
      throw error;
    }
  }
  if (!session) throw new Error("Router rejected all saved SSH logins; no settings were sent");
  try {
    if (session.prompt.endsWith(">")) await session.command("en");
    if (!session.prompt.endsWith("#") || session.prompt.includes("(")) throw new Error("Unsupported router SSH command prompt; no settings were sent");
    // Probe readback before any write. Firmware that lacks this command stops safely.
    const before = await session.command("show running-config");
    if (!/^(?:\s*(?:hostname|ntp |clock |firewall |interface |!|version )).+/m.test(before)) throw new Error("Router SSH configuration readback unsupported; no settings were sent");
    const commands = firewall ?? ntpCommands(settings, before);
    const lines = configLines(before);
    if (firewall) {
      for (const command of commands) {
        const prefix = command.split(" rule ")[0] + " rule ";
        if (lines.some((line) => line.startsWith(prefix) && line !== command)) throw new Error("A custom firewall ID already has a different rule; no settings were sent");
      }
    }
    const pending = commands.filter((c) => !lines.includes(c));
    if (pending.length) {
      await session.command("configure terminal");
      if (!session.prompt.includes("(config)")) throw new Error("Router refused configuration mode; no settings were sent");
      for (const command of pending) await session.command(command);
      await session.command("end");
      await session.command("write");
    }
    const after = configLines(await session.command("show running-config"));
    const expected = commands.filter((c) => c !== "no ntp secondary-server");
    if (expected.some((c) => !after.includes(c)) || (commands.includes("no ntp secondary-server") && after.some((c) => c.startsWith("ntp secondary-server ")))) throw new Error("Router SSH settings verification failed; check the router before retrying");
    if (kind === "ntp") {
      await session.command("configure terminal");
      await session.command("ntp sync");
      await session.command("end");
    }
    return { status: 200, verified: true, transport: "ssh", ...(firewall ? { rules: commands.length } : {}) };
  } finally { session.close(); }
}

export async function connectRouterSsh(ip, login) {
  const { Client } = await import("ssh2");
  const knownFile = path.join(process.env.FIELD_OPS_HELPER_DIR || path.dirname(fileURLToPath(import.meta.url)), "router-host-keys.json");
  let known = {};
  try { known = JSON.parse(await fs.readFile(knownFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw new Error("Cannot read saved router SSH host keys"); }
  return new Promise((resolve, reject) => {
    const client = new Client();
    let stream, buffer = "", pending, fingerprint, ready = false, prompt = "", hostKeyChanged = false, tcpConnected = false;
    // Distinguish an unreachable port 22 from a slow SSH handshake on older firmware.
    client.on("connect", () => { tcpConnected = true; });
    const fail = (message, auth = false, unreachable = false) => {
      if (pending) { const current = pending; pending = undefined; clearTimeout(current.timer); current.reject(new Error(message)); }
      const error = Object.assign(new Error(message), { authenticationRejected: auth, unreachable });
      client.end();
      if (!ready) reject(error);
    };
    const waitPrompt = () => new Promise((ok, no) => {
      pending = { resolve: ok, reject: no, timer: setTimeout(() => fail("Router SSH command timed out; check the router before retrying"), 15_000) };
    });
    const session = {
      get prompt() { return prompt; },
      async command(command) {
        buffer = "";
        const response = waitPrompt();
        stream.write(`${command}\n`);
        const output = await response;
        if (CLI_ERROR.test(output)) throw new Error("Router rejected an SSH command; check firmware support and permissions before retrying");
        return output;
      },
      close() { if (pending) clearTimeout(pending.timer); stream?.end(); client.end(); },
    };
    client.on("error", (error) => {
      const auth = error.level === "client-authentication";
      const message = hostKeyChanged ? "Router SSH fingerprint changed; administrator verification required; no settings were sent"
        : auth ? "Router rejected SSH login"
        : error.code === "ECONNREFUSED" ? "Router SSH port 22 refused the connection; no settings were sent"
        : (error.level === "client-timeout" || error.code === "ETIMEDOUT") && !tcpConnected ? "Router SSH port 22 is not reachable from the helper (no answer); check that SSH is enabled on the router and allowed on the cellular connection; no settings were sent"
        : error.level === "client-timeout" || error.code === "ETIMEDOUT" ? "Router answered on port 22 but the SSH login did not finish in time; no settings were sent"
        : ["EHOSTUNREACH", "ENETUNREACH"].includes(error.code) ? "Helper has no network route to the router; no settings were sent"
        : /no matching|handshake failed/i.test(error.message || "") ? "Router SSH algorithm negotiation failed; no settings were sent"
        : "Router SSH connection failed; no automatic retry";
      const unreachable = !tcpConnected && !hostKeyChanged && (["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"].includes(error.code) || error.level === "client-timeout");
      fail(message, auth && !hostKeyChanged, unreachable);
    });
    client.on("close", () => { if (pending || !ready) fail("Router SSH connection closed; check the router before retrying"); });
    client.on("ready", async () => {
      // Trust on first successful authenticated connection; refuse later key changes.
      try {
        if (!known[ip]) {
          known[ip] = fingerprint;
          const temp = `${knownFile}.${process.pid}.tmp`;
          await fs.writeFile(temp, JSON.stringify(known), { mode: 0o600, flag: "wx" });
          await fs.rename(temp, knownFile);
        }
      } catch { fail("Could not save router SSH host key; no settings were sent"); return; }
      client.shell({ term: "vt100", cols: 200, rows: 1000 }, (error, shell) => {
        if (error) { fail("Router SSH interactive CLI unavailable; no settings were sent"); return; }
        stream = shell;
        const initial = waitPrompt();
        initial.then(() => { ready = true; resolve(session); }, () => reject(new Error("Router SSH CLI prompt unsupported; no settings were sent")));
        const receive = (data) => {
          buffer += data.toString().replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
          if (buffer.length > 1024 * 1024) { fail("Router SSH response too large; check router before retrying"); return; }
          const match = buffer.match(PROMPT);
          if (match && pending) {
            prompt = match[1];
            const done = pending; pending = undefined; clearTimeout(done.timer); done.resolve(buffer);
          }
        };
        stream.on("data", receive);
        stream.stderr.on("data", receive);
        stream.on("error", () => fail("Router SSH response interrupted; check router before retrying"));
      });
    });
    client.connect({ host: ip, port: 22, username: login.username, password: login.password, readyTimeout: 30_000,
      // Append only the legacy host signature required by UR35 35.3.0.8-r2;
      // keep modern key exchange, encryption and MAC preferences unchanged.
      algorithms: { serverHostKey: { append: ["ssh-rsa"] } },
      hostVerifier: (key) => {
        fingerprint = createHash("sha256").update(key).digest("hex");
        hostKeyChanged = Boolean(known[ip] && known[ip] !== fingerprint);
        return !hostKeyChanged;
      } });
  });
}