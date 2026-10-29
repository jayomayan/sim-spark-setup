import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePing, pingTarget } from "./ping.mjs";

const success = "4 packets transmitted, 4 received, 0% packet loss, time 3000ms\nrtt min/avg/max/mdev = 1.200/2.300/3.400/0.100 ms";
test("ping reports packet counts, loss and latency", () => {
  assert.deepEqual(parsePing(success), { reachable: true, transmitted: 4, received: 4, packetLoss: 0, minMs: 1.2, avgMs: 2.3, maxMs: 3.4 });
  assert.equal(parsePing(success.replace("4 received, 0%", "2 received, 50%")).packetLoss, 50);
});
test("no replies are a completed ping, not a service failure", async () => {
  const result = await pingTarget("10.0.0.1", async () => { throw { code: 1, stdout: "4 packets transmitted, 0 received, 100% packet loss" }; });
  assert.equal(result.reachable, false);
  assert.equal(result.packetLoss, 100);
  assert.equal(result.avgMs, null);
});
test("ping uses fixed arguments without a shell", async () => {
  await pingTarget("10.0.0.1", async (file, args, options) => {
    assert.equal(file, "ping");
    assert.deepEqual(args, ["-n", "-c", "4", "-W", "2", "-w", "10", "10.0.0.1"]);
    assert.equal(options.shell, undefined);
    assert.equal(options.env.LC_ALL, "C");
    return { stdout: success };
  });
  for (const ip of ["127.0.0.1", "8.8.8.8", "10.0.0.1;whoami", "010.0.0.1"]) await assert.rejects(pingTarget(ip));
});
test("missing ping binary and permission errors never become no-reply results", async () => {
  for (const code of ["ENOENT", 2]) await assert.rejects(pingTarget("10.0.0.1", async () => { throw { code }; }), /unavailable/);
  assert.throws(() => parsePing("invalid output"));
});