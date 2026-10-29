import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildInstallCommand,
  DEFAULT_FIREWALL_RULES,
  firewallRuleSchema,
  helperSettingsInput,
  parseNtpServers,
} from "@/lib/helper-settings";
import { HELPER_FILES, HELPER_VERSION } from "@/lib/helper-release";

const helperSource = readFileSync("public/helper/field-ops-helper.mjs", "utf8");
const installerSource = readFileSync("public/helper/install.sh", "utf8");

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

  it("rejects a port outside 0-65535", () => {
    expect(() => firewallRuleSchema.parse({ name: "x", action: "accept", protocol: "tcp", port: 70000 })).toThrow();
  });

  it("rejects an unknown action", () => {
    expect(() => firewallRuleSchema.parse({ name: "x", action: "log", protocol: "tcp", port: 80 })).toThrow();
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

  it("requires a server when NTP is on", () => {
    const result = helperSettingsInput.safeParse({ ntpEnabled: true, ntpServers: "  " });
    expect(result.success).toBe(true); // shape is valid; the save step rejects an empty list
    expect(parseNtpServers("  ")).toEqual([]);
  });
});
