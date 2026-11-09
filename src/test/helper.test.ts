import { readFileSync } from "node:fs";
import { createCipheriv, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  buildInstallCommand,
  DEFAULT_FIREWALL_RULES,
  firewallRuleSchema,
  helperSettingsInput,
  parseNtpServers,
} from "@/lib/helper-settings";
import { HELPER_FILES, HELPER_VERSION } from "@/lib/helper-release";
import { pingResultSchema } from "@/lib/site-connectivity";

const helperSource = readFileSync("public/helper/field-ops-helper.mjs", "utf8");
const installerSource = readFileSync("public/helper/install.sh", "utf8");

describe("live helper ping", () => {
  it("sends four probes even when initial packets are lost and returns displayable statistics", async () => {
    const start = helperSource.indexOf("  async site_ping(");
    const end = helperSource.indexOf("  async site_capture(", start);
    const calls: unknown[][] = [];
    const ping = runInNewContext(`({${helperSource.slice(start, end)}}).site_ping`, {
      checkIp: (ip: string) => ip,
      run: async (command: string, args: string[], timeout: number) => {
        calls.push([command, args, timeout]);
        // Reproduce the VM's count+deadline behavior if that flag regresses.
        return { code: 0, out: args.includes("-w")
          ? "7 packets transmitted, 4 received, 42.8571% packet loss\nrtt min/avg/max/mdev = 69.739/74.512/76.877/2.808 ms"
          : "4 packets transmitted, 3 received, 25% packet loss\nrtt min/avg/max/mdev = 79.119/79.862/81.253/0.984 ms" };
      },
    });
    const result = pingResultSchema.parse(await ping({ ip: "10.194.94.52" }));
    expect(calls).toEqual([["ping", ["-n", "-c", "4", "-W", "2", "10.194.94.52"], 15_000]]);
    expect(result).toEqual({ reachable: true, transmitted: 4, received: 3, packetLoss: 25,
      minMs: 79.119, avgMs: 79.862, maxMs: 81.253 });
  });
});

describe("helper release", () => {
  it("serves the same version the helper program reports about itself", () => {
    // A drift here would leave every installed machine polling for an update that never lands.
    expect(helperSource).toContain(`const VERSION = "${HELPER_VERSION}"`);
  });

  it("installs exactly the files the release advertises", () => {
    for (const file of HELPER_FILES) {
      expect(installerSource).toContain(`for f in `);
      expect(installerSource).toContain(file);
    }
  });

  it("refuses a console address that isn't https", () => {
    expect(installerSource).toContain('die "the console address must be https://"');
  });
});

describe("install command", () => {
  it("is a single line the admin can paste over SSH", () => {
    const command = buildInstallCommand("https://console.example.com", "abc123");
    expect(command).toBe(
      "curl -fsSL https://console.example.com/helper/install.sh | sudo bash -s -- --console https://console.example.com --code abc123",
    );
    expect(command).not.toContain("\n");
  });
});

describe("firewall rules", () => {
  it("accepts the built-in template", () => {
    expect(() => helperSettingsInput.parse({ firewallRules: DEFAULT_FIREWALL_RULES })).not.toThrow();
  });

  it("requires the rule text", () => {
    expect(() => firewallRuleSchema.parse({ rule: "", description: "empty" })).toThrow();
  });

  it("keeps a rule without a description", () => {
    expect(firewallRuleSchema.parse({ rule: "accept tcp/443" })).toEqual({
      rule: "accept tcp/443",
      description: "",
    });
  });
});

describe("Milesight HTTPS router jobs", () => {
  function harness(options: { reject?: boolean; restricted?: boolean; malformed?: boolean; reboot?: boolean; failReadback?: boolean } = {}) {
    const start = helperSource.indexOf("// Milesight UR-series /cgi API.");
    const end = helperSource.indexOf("// --- Site Connectivity Check:", start);
    const calls: { body: any; token?: string }[] = [];
    let list = [{ id: "existing", rule: "-I INPUT -s 192.168.3.240 -j DROP", desc: "keep" }];
    let time: any = { timezone: "UTC Europe/London", timezone_type: 1, update_interval: 60, ntp_master: 0 };
    const routerRequest = async (_ip: string, body: any, token?: string) => {
      calls.push({ body, token });
      if (body.function === "login") {
        if (options.restricted) return { status: -2 };
        if (options.reject || body.values[0].username === "first") return { status: -1 };
        return { status: 0, result: [{ td: "test-session", ysrole: 1 }] };
      }
      if (body.function === "apply") return { status: 0, result: [{ reboot: options.reboot ? 1 : 0, reconnect: 0 }] };
      if (body.function === "get") {
        if (options.malformed) return { status: 0, result: [] };
        const firewall = body.core === "yruo_firewall_custom";
        return { status: 0, result: [{ get: [{ type: firewall ? "yruo_firewall_custom" : "time", index: firewall ? "config-index" : 0,
          value: firewall ? { list } : time }] }] };
      }
      if (body.core === "yruo_firewall_custom") { if (!options.failReadback) list = body.values[0].value.list; }
      else time = body.values[0].value;
      return { status: 0, result: [] };
    };
    // Override only transport; execute real conversion/login/get/set/apply/read-back functions.
    const functions = runInNewContext(`${helperSource.slice(start, end)}; routerRequest = transport; ({applyFirewall, applyNtp, convertFirewallRules, mergeFirewallRules, encryptRouterPassword})`, {
      config: { routerLogins: [{ username: "first", password: "one" }, { username: "second", password: "two" }] },
      transport: routerRequest, createCipheriv, randomUUID, Buffer, process: { env: {} },
    });
    return { functions, calls };
  }

  it("converts all 17 supplied commands, preserving actions, destinations and sequence", () => {
    const { functions } = harness();
    const commands = [
      "firewall access-control custom id csrid rule -I OUTPUT -d 37.17.191.17 -j DROP",
      "firewall access-control custom id csrid1 rule -I OUTPUT -d 52.31.149.80 -j DROP",
      "firewall access-control custom id csrid2 rule -I OUTPUT -d 46.137.47.218 -j DROP",
      "firewall access-control custom id csrid3 rule -I OUTPUT -d 54.73.92.158 -j DROP",
      "firewall access-control custom id csrid4 rule -I FORWARD 1 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT",
      "firewall access-control custom id csrid5 rule -I FORWARD 2 -d 10.10.0.0/23 -j ACCEPT",
      "firewall access-control custom id csrid6 rule -I FORWARD 2 -d 10.0.50.0/24 -j ACCEPT",
      "firewall access-control custom id csrid7 rule -I FORWARD 2 -d 10.0.53.0/24 -j ACCEPT",
      "firewall access-control custom id csrid8 rule -I FORWARD 2 -d 10.0.81.0/24 -j ACCEPT",
      "firewall access-control custom id csrid9 rule -I FORWARD 2 -d 10.0.60.0/24 -j ACCEPT",
      "firewall access-control custom id csrid10 rule -I FORWARD 3 -m conntrack --ctstate DNAT -j ACCEPT",
      "firewall access-control custom id csrid11 rule -A FORWARD -j DROP",
      "firewall access-control custom id csrid12 rule -A POSTROUTING -d 10.10.0.0/23 -j MASQUERADE",
      "firewall access-control custom id csrid13 rule -A POSTROUTING -d 10.0.50.0/24 -j MASQUERADE",
      "firewall access-control custom id csrid14 rule -A POSTROUTING -d 10.0.53.0/24 -j MASQUERADE",
      "firewall access-control custom id csrid15 rule -A POSTROUTING -d 10.0.81.0/24 -j MASQUERADE",
      "firewall access-control custom id csrid16 rule -A POSTROUTING -d 10.0.60.0/24 -j MASQUERADE"
];
    const converted = functions.convertFirewallRules(commands.map((rule: string) => ({ rule, description: "" })));
    expect(converted).toHaveLength(17);
    expect(converted.map((rule: any) => rule.id)).toEqual(["csrid", ...Array.from({ length: 16 }, (_, i) => `csrid${i + 1}`)]);
    expect(converted.map((rule: any) => rule.rule)).toEqual(commands.map((command: string) => {
      const stripped = command.replace(/^firewall access-control custom id \S+ rule /, "");
      return stripped.includes("POSTROUTING") ? `-t nat ${stripped}` : stripped;
    }));
  });

  it("logs in before changes, preserves existing rules, applies and reads them back", async () => {
    const { functions, calls } = harness();
    expect(await functions.applyFirewall("10.0.0.1", [{ rule: "firewall access-control custom id csrid rule -I OUTPUT -d 37.17.191.17 -j DROP", description: "" }])).toEqual({ status: 200, verified: true, rules: 1 });
    expect(calls.map((call) => call.body.function)).toEqual(["login", "login", "get", "set", "apply", "get"]);
    expect(calls[0]?.body.values[0].password).not.toBe("one");
    expect(calls.slice(2).every((call) => call.token === "test-session")).toBe(true);
    expect(calls[3]?.body.values[0]).toMatchObject({ index: "config-index", value: { list: [
      { id: "existing", rule: "-I INPUT -s 192.168.3.240 -j DROP", desc: "keep" },
      { id: "csrid", rule: "-I OUTPUT -d 37.17.191.17 -j DROP", desc: "" },
    ] } });
  });

  it("sends no settings when all credentials are rejected", async () => {
    const { functions, calls } = harness({ reject: true });
    await expect(functions.applyFirewall("10.0.0.1", [{ rule: "-I OUTPUT -j DROP" }])).rejects.toThrow("Router rejected all saved logins");
    expect(calls.map((call) => call.body.function)).toEqual(["login", "login"]);
  });

  it("stops on restricted login rather than trying another password", async () => {
    const { functions, calls } = harness({ restricted: true });
    await expect(functions.applyFirewall("10.0.0.1", [{ rule: "-I OUTPUT -j DROP" }])).rejects.toThrow("restricted");
    expect(calls).toHaveLength(1);
  });

  it("refuses unsupported firmware responses before writes", async () => {
    const { functions, calls } = harness({ malformed: true });
    await expect(functions.applyFirewall("10.0.0.1", [{ rule: "-I OUTPUT -j DROP" }])).rejects.toThrow("Unsupported router configuration");
    expect(calls.some((call) => call.body.function === "set")).toBe(false);
  });

  it("does not report completion when apply requires reboot", async () => {
    const { functions } = harness({ reboot: true });
    await expect(functions.applyFirewall("10.0.0.1", [{ rule: "-I OUTPUT -j DROP" }])).rejects.toThrow("manual router reboot");
  });

  it("rejects readback mismatches rather than reporting success", async () => {
    const { functions } = harness({ failReadback: true });
    await expect(functions.applyFirewall("10.0.0.1", [{ rule: "-I OUTPUT -j DROP" }])).rejects.toThrow("verification failed");
  });

  it("preserves unrelated IDs and refuses conflicting identifiers and oversized lists", () => {
    const { functions } = harness();
    expect(() => functions.mergeFirewallRules([{ id: "csrid", rule: "-A INPUT -j ACCEPT" }], [{ id: "csrid", rule: "-A INPUT -j DROP" }])).toThrow("conflicts");
    expect(() => functions.mergeFirewallRules(Array.from({ length: 64 }, (_, i) => ({ id: `${i}`, rule: `-A INPUT -s 10.0.0.${i} -j ACCEPT` })), [{ id: "new", rule: "-A OUTPUT -j DROP" }])).toThrow("64");
  });

  it("maps NTP to documented time settings and preserves interval and server mode", async () => {
    const { functions, calls } = harness();
    expect(await functions.applyNtp("10.0.0.1", { enabled: true, servers: ["pool.ntp.org", "time.google.com"], timezone: "Asia/Manila" })).toEqual({ status: 200, verified: true });
    expect(calls.map((call) => call.body.function)).toEqual(["login", "login", "get", "set", "apply", "get"]);
    expect(calls[3]?.body).toMatchObject({ core: "yruo_system", values: [{ base: "time", index: 0, value: {
      timezone: "UTC+8 Asia/Manila", timezone_type: 0, set_type: 0, ntp_enable: 1,
      ntp_address: "pool.ntp.org", ntp_address_secondary: "time.google.com", update_interval: 60, ntp_master: 0,
    } }] });
  });

  it("refuses unsupported NTP server counts without logging in", async () => {
    const { functions, calls } = harness();
    await expect(functions.applyNtp("10.0.0.1", { enabled: true, servers: ["a", "b", "c"], timezone: "Asia/Manila" })).rejects.toThrow("one or two");
    expect(calls).toHaveLength(0);
  });

  it("uses HTTPS /cgi with the login session and does not follow redirects", async () => {
    const start = helperSource.indexOf("function routerRequest(");
    const end = helperSource.indexOf("async function routerLogin(", start);
    const requests: any[] = [];
    const transport = runInNewContext(`${helperSource.slice(start, end)}; routerRequest`, {
      Buffer, https: { request: (options: any, callback: (res: any) => void) => {
        requests.push(options);
        return { on: () => {}, end: () => callback({ statusCode: 302, on: (event: string, fn: () => void) => { if (event === "end") fn(); } }) };
      } },
    });
    await expect(transport("10.0.0.1", { function: "get" }, "session")).rejects.toThrow("302");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ host: "10.0.0.1", path: "/cgi", method: "POST", headers: { "x-session-id": "session" } });
    expect(requests[0].headers.Authorization).toBeUndefined();
  });
});

describe("router credentials file", () => {
  it("writes one pair per line with owner-only permissions and replaces removed logins", async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), "helper-credentials-"));
    try {
      const start = helperSource.indexOf("async function writeRouterCredentials(");
      const end = helperSource.indexOf("async function loadConfig(");
      const write = runInNewContext(`${helperSource.slice(start, end)}; writeRouterCredentials`, {
        fs, path, SELF_DIR: directory, process: { pid: process.pid },
      });
      await write([{ username: "first", password: "one" }, { username: "second", password: "two words" }]);
      const target = path.join(directory, "UR35_Credentials.txt");
      expect(await fs.readFile(target, "utf8")).toBe("first one\nsecond two words\n");
      expect((await fs.stat(target)).mode & 0o777).toBe(0o600);
      await write([{ username: "second", password: "new" }]);
      expect(await fs.readFile(target, "utf8")).toBe("second new\n");
      await write([]);
      expect(await fs.readFile(target, "utf8")).toBe("");
      expect(await fs.readdir(directory)).toEqual(["UR35_Credentials.txt"]);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  it("rejects extra lines in passwords", () => {
    expect(helperSettingsInput.safeParse({ firewallRules: [], routerLogins: [{
      id: "00000000-0000-4000-8000-000000000001", username: "first", password: "one\nsecond two",
    }] }).success).toBe(false);
  });
});

describe("ntp servers", () => {
  it("keeps clean hosts and drops junk, in order", () => {
    expect(parseNtpServers("https://Pool.NTP.org/path, time.google.com , ,, !!")).toEqual([
      "pool.ntp.org",
      "time.google.com",
    ]);
  });

  it("caps the list at eight servers", () => {
    const many = Array.from({ length: 20 }, (_, i) => `n${i}.example.com`).join(", ");
    expect(parseNtpServers(many)).toHaveLength(8);
  });

  it("allows an empty server list through the form, which the save step then rejects", () => {
    const result = helperSettingsInput.safeParse({ ntpEnabled: true, ntpServers: "  ", firewallRules: [] });
    expect(result.success).toBe(true);
    expect(parseNtpServers("  ")).toEqual([]); // saveHelperConfig refuses this combination
  });
});
