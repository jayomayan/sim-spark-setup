import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { expect, it, vi } from "vitest";

const source = readFileSync("public/helper/router-ssh.mjs", "utf8");
const start = source.indexOf("export function firewallCommands");
const end = source.indexOf("export async function connectRouterSsh");
const functions = runInNewContext(source.slice(start, end).replaceAll("export ", "") + "; ({firewallCommands, ntpCommands, configureRouter})");
const rule = "firewall access-control custom id csrid rule -I OUTPUT -d 37.17.191.17 -j DROP";
const ntp = { enabled: true, servers: ["pool.ntp.org", "time.google.com"], timezone: "Asia/Manila" };

function harness(initial = "hostname Router\nntp update-interval 60", rejectCommand = "") {
  let config = initial;
  const commands: string[] = [];
  const session = { prompt: "Router#", close: vi.fn(), command: async (command: string) => {
    commands.push(command);
    if (command === rejectCommand) throw new Error("Router rejected an SSH command");
    if (command === "show running-config") return config;
    if (command === "configure terminal") session.prompt = "Router(config)#";
    else if (command === "end") session.prompt = "Router#";
    else if (command !== "write" && command !== "ntp sync") config += "\n" + command;
    return "";
  } };
  const connect = vi.fn(async (_ip: string, login: { username: string }) => {
    if (login.username === "first") throw Object.assign(new Error("Rejected"), { authenticationRejected: true });
    return session;
  });
  const logins = [{ username: "first", password: "one" }, { username: "second", password: "two" }];
  return { commands, session, connect, logins };
}

it("uses saved ordered SSH logins and saves original firewall commands after readback", async () => {
  const h = harness();
  expect(await functions.configureRouter("10.194.89.128", h.logins, "firewall", [{ rule }], h.connect)).toMatchObject({ verified: true, transport: "ssh", rules: 1 });
  expect(h.connect.mock.calls.map((c) => c[1])).toEqual(h.logins);
  expect(h.commands).toEqual(["show running-config", "configure terminal", rule, "end", "write", "show running-config"]);
  expect(h.session.close).toHaveBeenCalledOnce();
});

it("converts the existing NTP JSON to server and Manila CLI commands preserving interval", async () => {
  const h = harness();
  await functions.configureRouter("10.194.89.128", h.logins, "ntp", ntp, h.connect);
  expect(h.commands).toEqual(["show running-config", "configure terminal", "clock timezone UTC+8", "clock zonename Asia/Manila", "ntp server pool.ntp.org", "ntp secondary-server time.google.com", "end", "write", "show running-config", "configure terminal", "ntp sync", "end"]);
});

it("refuses conflicting firewall IDs before writing", async () => {
  const h = harness("hostname Router\nfirewall access-control custom id csrid rule -A INPUT -j DROP");
  await expect(functions.configureRouter("10.194.89.128", h.logins, "firewall", [{ rule }], h.connect)).rejects.toThrow("different rule");
  expect(h.commands).toEqual(["show running-config"]);
});

it("does not replay commands or switch accounts after a configuration error", async () => {
  const h = harness(undefined, rule);
  await expect(functions.configureRouter("10.194.89.128", h.logins, "firewall", [{ rule }], h.connect)).rejects.toThrow("rejected");
  expect(h.connect).toHaveBeenCalledTimes(2);
  expect(h.commands.filter((c) => c === rule)).toHaveLength(1);
  expect(h.commands).not.toContain("write");
});

it("refuses disabled NTP rather than guessing an enable command", () => {
  expect(() => functions.ntpCommands(ntp, "no ntp\nntp update-interval 60")).toThrow("already be enabled");
});

it("rejects shell injection before login", async () => {
  const h = harness();
  await expect(functions.configureRouter("10.194.89.128", h.logins, "firewall", [{ rule: rule + "; reboot" }], h.connect)).rejects.toThrow("shell commands");
  expect(h.connect).not.toHaveBeenCalled();
});

function transportHarness(savedKey?: string) {
  let options: any;
  const writeFile = vi.fn(async () => {});
  const rename = vi.fn(async () => {});
  class Client extends EventEmitter {
    connect(config: any) {
      options = config;
      queueMicrotask(() => {
        if (!config.hostVerifier(Buffer.from("router-key"))) {
          this.emit("error", { level: "handshake", message: "Host denied" });
          return;
        }
        this.emit("ready");
      });
    }
    shell(_options: any, callback: (err: unknown, stream: any) => void) {
      const stream = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), end: () => {} });
      callback(null, stream);
      queueMicrotask(() => stream.emit("data", Buffer.from("ROUTER> ")));
    }
    end() {}
  }
  const connect = runInNewContext(source.slice(end).replace("export ", "").replace('await import("ssh2")', "({ Client })").replace("import.meta.url", '"file:///private-helper/router-ssh.mjs"') + "; connectRouterSsh", {
    Client, createHash, Buffer, path, process: { env: { FIELD_OPS_HELPER_DIR: "/private-helper" } },
    fs: { readFile: async () => JSON.stringify(savedKey ? { "10.194.89.128": savedKey } : {}), writeFile, rename },
    setTimeout, clearTimeout, PROMPT: /(?:^|\n)([\w.-]+(?:\([^\r\n]*\))?[>#])\s*$/, CLI_ERROR: /error/i,
  });
  return { connect, writeFile, rename, options: () => options };
}

it("appends ssh-rsa for the UR35 and accepts/saves the first fingerprint without prompting", async () => {
  const h = transportHarness();
  const session = await h.connect("10.194.89.128", { username: "admin", password: "test-password" });
  expect(h.options()).toMatchObject({ port: 22, username: "admin", password: "test-password", algorithms: { serverHostKey: { append: ["ssh-rsa"] } } });
  expect(h.options().algorithms.kex).toBeUndefined();
  expect(h.writeFile).toHaveBeenCalledWith(expect.any(String), JSON.stringify({ "10.194.89.128": createHash("sha256").update("router-key").digest("hex") }), { mode: 0o600, flag: "wx" });
  expect(h.rename).toHaveBeenCalledOnce();
  expect(session.prompt).toBe("ROUTER>");
  session.close();
});

it("rejects changed fingerprints without replacing the saved key or retrying authentication", async () => {
  const h = transportHarness("different-key");
  await expect(h.connect("10.194.89.128", { username: "admin", password: "test-password" })).rejects.toMatchObject({ message: expect.stringContaining("fingerprint changed"), authenticationRejected: false });
  expect(h.writeFile).not.toHaveBeenCalled();
});