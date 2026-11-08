import { readFileSync } from "node:fs";
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

describe("multiple router logins", () => {
  it("accepts two independent username/password pairs", () => {
    const routerLogins = [
      { id: "00000000-0000-4000-8000-000000000001", username: "router-one", password: "first-pass" },
      { id: "00000000-0000-4000-8000-000000000002", username: "router-two", password: "second-pass" },
    ];
    expect(helperSettingsInput.parse({ routerLogins, firewallRules: [] }).routerLogins).toEqual(routerLogins);
  });

  it("tries the second pair after an authentication rejection", async () => {
    const attempts: string[] = [];
    const start = helperSource.indexOf("async function routerPost(");
    const end = helperSource.indexOf("function routerPostWithLogin(");
    const post = runInNewContext(`${helperSource.slice(start, end)}; routerPost`, {
      config: { routerLogins: [{ username: "one", password: "a" }, { username: "two", password: "b" }] },
      routerPostWithLogin: async (_ip: string, _path: string, _body: unknown, login: { username: string }) => {
        attempts.push(login.username);
        return { status: login.username === "one" ? 401 : 200 };
      },
    });
    expect(await post("10.0.0.1", "/api/firewall/rules", {})).toEqual({ status: 200 });
    expect(attempts).toEqual(["one", "two"]);
  });

  it("does not retry a settings error with another login", async () => {
    const attempts: string[] = [];
    const start = helperSource.indexOf("async function routerPost(");
    const end = helperSource.indexOf("function routerPostWithLogin(");
    const post = runInNewContext(`${helperSource.slice(start, end)}; routerPost`, {
      config: { routerLogins: [{ username: "one", password: "a" }, { username: "two", password: "b" }] },
      routerPostWithLogin: async (_ip: string, _path: string, _body: unknown, login: { username: string }) => {
        attempts.push(login.username);
        return { status: 500 };
      },
    });
    await expect(post("10.0.0.1", "/api/system/ntp", {})).rejects.toThrow("Router rejected settings (500)");
    expect(attempts).toEqual(["one"]);
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
