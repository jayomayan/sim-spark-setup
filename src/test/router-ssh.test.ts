import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { expect, it, vi } from "vitest";

const source = readFileSync("public/helper/router-ssh.mjs", "utf8");
const start = source.indexOf("export function firewallCommands");
const end = source.indexOf("export async function connectRouterSsh");
const functions = runInNewContext(source.slice(start, end).replaceAll("export ", "") + "; ({firewallCommands, miscCommands, configureRouter})");
const rule = "firewall access-control custom id csrid rule -I OUTPUT -d 37.17.191.17 -j DROP";

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

it("reports firewall milestones in execution order without exposing credentials or raw commands", async () => {
  const h = harness();
  const events: { stage: string; index?: number; total?: number }[] = [];
  await functions.configureRouter("10.194.89.128", h.logins, "firewall", [{ rule }], h.connect, { onProgress: (event: any) => events.push(event) });
  expect(events.map((event) => event.stage)).toEqual(["connecting", "login_rejected", "connecting", "authenticated", "privileged", "reading", "checking", "configuring", "rule", "rule_applied", "saving", "saved", "verifying", "verified", "closed"]);
  expect(events.find((event) => event.stage === "rule")).toEqual({ stage: "rule", index: 1, total: 1 });
  expect(events.every((event) => Object.keys(event).every((key) => ["stage", "index", "total"].includes(key)))).toBe(true);
});

it("does not report saved or verified milestones after a rule fails", async () => {
  const h = harness(undefined, rule);
  const stages: string[] = [];
  await expect(functions.configureRouter("10.194.89.128", h.logins, "firewall", [{ rule }], h.connect, { onProgress: (event: any) => stages.push(event.stage) })).rejects.toThrow("rejected");
  expect(stages).toContain("rule");
  expect(stages).not.toContain("rule_applied");
  expect(stages).not.toContain("saved");
  expect(stages).not.toContain("verified");
  expect(stages.at(-1)).toBe("closed");
});

it("applies miscellaneous commands exactly as saved, then verifies them", async () => {
  const h = harness();
  const commands = ["clock timezone UTC+8", "ntp server pool.ntp.org"];
  expect(await functions.configureRouter("10.194.89.128", h.logins, "misc", commands, h.connect)).toMatchObject({ verified: true, transport: "ssh", commands: 2 });
  expect(h.commands).toEqual(["show running-config", "configure terminal", "clock timezone UTC+8", "ntp server pool.ntp.org", "end", "write", "show running-config"]);
});

it("reports miscellaneous command milestones in execution order without raw output", async () => {
  const h = harness();
  const events: { stage: string; index?: number; total?: number }[] = [];
  await functions.configureRouter("10.194.89.128", h.logins, "misc", ["clock timezone UTC+8"], h.connect, { onProgress: (event: any) => events.push(event) });
  expect(events.map((event) => event.stage)).toEqual(["connecting", "login_rejected", "connecting", "authenticated", "privileged", "reading", "configuring", "command", "command_applied", "saving", "saved", "verifying", "verified", "closed"]);
  expect(events.find((event) => event.stage === "command")).toEqual({ stage: "command", index: 1, total: 1 });
});

it("skips miscellaneous commands the router already has", async () => {
  const h = harness("hostname Router\nntp update-interval 60\nclock timezone UTC+8");
  expect(await functions.configureRouter("10.194.89.128", h.logins, "misc", ["clock timezone UTC+8"], h.connect)).toMatchObject({ verified: true, commands: 1 });
  expect(h.commands).toEqual(["show running-config", "show running-config"]);
});

it("does not require immediate-effect commands to reappear in the saved configuration", async () => {
  const h = harness();
  expect(await functions.configureRouter("10.194.89.128", h.logins, "misc", ["ntp sync"], h.connect)).toMatchObject({ verified: true });
  expect(h.commands).toContain("ntp sync");
});

it("refuses a miscellaneous command the router rejects, without saving", async () => {
  const h = harness(undefined, "ntp server pool.ntp.org");
  await expect(functions.configureRouter("10.194.89.128", h.logins, "misc", ["ntp server pool.ntp.org"], h.connect)).rejects.toThrow("rejected");
  expect(h.commands).not.toContain("write");
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

it("refuses shell injection in miscellaneous commands before login", async () => {
  const h = harness();
  await expect(functions.configureRouter("10.194.89.128", h.logins, "misc", ["ntp server pool.ntp.org; reboot"], h.connect)).rejects.toThrow("shell commands");
  expect(h.connect).not.toHaveBeenCalled();
});

it("rejects shell injection before login", async () => {
  const h = harness();
  await expect(functions.configureRouter("10.194.89.128", h.logins, "firewall", [{ rule: rule + "; reboot" }], h.connect)).rejects.toThrow("shell commands");
  expect(h.connect).not.toHaveBeenCalled();
});

function transportHarness(savedKey?: string, timeout?: "tcp" | "handshake") {
  let options: any;
  const writeFile = vi.fn(async () => {});
  const rename = vi.fn(async () => {});
  class Client extends EventEmitter {
    connect(config: any) {
      options = config;
      queueMicrotask(() => {
        if (timeout) {
          if (timeout === "handshake") this.emit("connect");
          this.emit("error", { level: "client-timeout", message: "Timed out while waiting for handshake" });
          return;
        }
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
  const connect = runInNewContext(source.slice(end).replace("export ", "").replace('await import("ssh2")', "({ Client: MockClient })").replace("import.meta.url", '"file:///private-helper/router-ssh.mjs"') + "; connectRouterSsh", {
    MockClient: Client, createHash, Buffer, path, process: { env: { FIELD_OPS_HELPER_DIR: "/private-helper" } },
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

it("allows 30 seconds for older routers to finish the SSH login", async () => {
  const h = transportHarness();
  (await h.connect("10.194.89.128", { username: "admin", password: "test-password" })).close();
  expect(h.options().readyTimeout).toBe(30_000);
});

it("reports an unreachable port 22 separately from a slow SSH login", async () => {
  const login = { username: "admin", password: "test-password" };
  await expect(transportHarness(undefined, "tcp").connect("10.194.89.128", login)).rejects.toMatchObject({ message: expect.stringContaining("port 22 is not reachable"), authenticationRejected: false });
  await expect(transportHarness(undefined, "handshake").connect("10.194.89.128", login)).rejects.toMatchObject({ message: expect.stringContaining("SSH login did not finish in time"), authenticationRejected: false });
});

it("rejects changed fingerprints without replacing the saved key or retrying authentication", async () => {
  const h = transportHarness("different-key");
  await expect(h.connect("10.194.89.128", { username: "admin", password: "test-password" })).rejects.toMatchObject({ message: expect.stringContaining("fingerprint changed"), authenticationRejected: false });
  expect(h.writeFile).not.toHaveBeenCalled();
});
it("retries an unreachable router before login, then applies settings once it answers", async () => {
  const h = harness();
  let attempts = 0;
  const connect = vi.fn(async (ip: string, login: { username: string }) => {
    if (++attempts <= 3) throw Object.assign(new Error("Router SSH port 22 refused the connection; no settings were sent"), { unreachable: true });
    return h.connect(ip, login);
  });
  let clock = 0;
  const sleep = vi.fn(async (ms: number) => { clock += ms; });
  const result = await functions.configureRouter("10.194.89.128", h.logins, "firewall", [{ rule }], connect, { retryMs: 180_000, delayMs: 10_000, sleep, now: () => clock });
  expect(result).toMatchObject({ verified: true });
  expect(sleep).toHaveBeenCalledTimes(3);
  expect(h.commands.filter((c) => c === rule)).toHaveLength(1);
});

it("stops retrying an unreachable router after 3 minutes without sending settings", async () => {
  let clock = 0;
  const connect = vi.fn(async () => { throw Object.assign(new Error("Router SSH port 22 is not reachable"), { unreachable: true }); });
  const sleep = vi.fn(async (ms: number) => { clock += ms; });
  await expect(functions.configureRouter("10.194.89.128", [{ username: "a", password: "b" }], "firewall", [{ rule }], connect, { retryMs: 180_000, delayMs: 10_000, sleep, now: () => clock })).rejects.toThrow("kept retrying for 3 minutes");
  expect(clock).toBe(180_000);
});
