import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
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