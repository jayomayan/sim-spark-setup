import { test } from "node:test";
import assert from "node:assert/strict";
import { PORTS, allowedRequest, allowedTarget, parseCidrs, portSchemes } from "./policy.mjs";
const cidrs = parseCidrs("10.194.72.0/24,192.168.1.0/24");
test("the four router ports are exactly 80, 443, 8443 and 8080", () => assert.deepEqual(PORTS, [80, 443, 8443, 8080]));
test("only port 8080 is tried over both protocols", () => {
  assert.deepEqual(portSchemes(80), ["http"]);
  assert.deepEqual(portSchemes(443), ["https"]);
  assert.deepEqual(portSchemes(8443), ["https"]);
  assert.deepEqual(portSchemes(8080), ["http", "https"]);
  assert.deepEqual(portSchemes(8081), []);
});
test("allowlist restricts private targets", () => {
  assert.equal(allowedTarget("10.194.72.40", 8443, cidrs), true);
  assert.equal(allowedTarget("10.194.72.40", 8080, cidrs), true);
  for (const ip of ["10.194.73.40", "127.0.0.1", "169.254.169.254", "8.8.8.8", "10.194.072.40", "10.194.72.300", "localhost"]) assert.equal(allowedTarget(ip, 80, cidrs), false);
  assert.equal(allowedTarget("10.194.72.40", 22, cidrs), false);
  assert.equal(allowedTarget("10.194.72.40", 8081, cidrs), false);
});
test("browser redirects and resources cannot escape target", () => {
  assert.equal(allowedRequest("https://10.194.72.40:8443/login", "10.194.72.40"), true);
  assert.equal(allowedRequest("http://10.194.72.40:8080/", "10.194.72.40"), true);
  assert.equal(allowedRequest("https://10.194.72.40:8080/login", "10.194.72.40"), true);
  for (const url of ["https://example.com", "http://10.194.72.41", "http://10.194.72.40:22", "http://10.194.72.40:8443", "https://10.194.72.40:80", "http://10.194.72.40:8081", "https://user:pass@10.194.72.40", "file:///etc/passwd", "ws://10.194.72.40"]) assert.equal(allowedRequest(url, "10.194.72.40"), false);
});
test("CIDR configuration cannot grant public or loopback access", () => {
  for (const value of ["", "0.0.0.0/0", "127.0.0.0/8", "10.0.0.0/7", "10.0.0.0/33"]) assert.throws(() => parseCidrs(value));
});
