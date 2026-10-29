import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { privateIp } from "./policy.mjs";

const execute = promisify(execFile);
export function parsePing(output) {
  const packets = output.match(/(\d+) packets transmitted,\s*(\d+) (?:packets )?received,.*?([\d.]+)% packet loss/);
  if (!packets) throw new Error("Ping returned an unreadable result.");
  const transmitted = Number(packets[1]), received = Number(packets[2]);
  if (transmitted !== 4 || received > transmitted) throw new Error("Unexpected ping result.");
  const timing = output.match(/(?:rtt|round-trip)[^=]*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/);
  if (received > 0 && !timing) throw new Error("Ping timing is unavailable.");
  return {
    reachable: received > 0, transmitted, received,
    packetLoss: (transmitted - received) / transmitted * 100,
    minMs: timing ? Number(timing[1]) : null,
    avgMs: timing ? Number(timing[2]) : null,
    maxMs: timing ? Number(timing[3]) : null,
  };
}

// This module runs only in the separately installed Linux service, never in the hosted app.
export async function pingTarget(ip, run = execute) {
  if (!privateIp(ip)) throw new Error("Invalid ping target.");
  let output;
  try {
    const result = await run("ping", ["-n", "-c", "4", "-W", "2", "-w", "10", ip], {
      timeout: 12_000, maxBuffer: 16_384, env: { ...process.env, LC_ALL: "C" },
    });
    output = result.stdout;
  } catch (error) {
    if (error.code === 1 && !error.killed) output = error.stdout;
    else throw new Error("Ping is unavailable. Check iputils-ping installation and ICMP permissions.");
  }
  return parsePing(output ?? "");
}