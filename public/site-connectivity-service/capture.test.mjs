import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { capturePort } from "./server.mjs";

const listen = (server, port) => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
const close = (server) => new Promise((resolve) => server.close(resolve));
const pageServer = () => http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<h1>Router test page</h1>"); });

test("captures a responding page and a real inaccessible-port screenshot", async () => {
  // Loopback is used only for isolated capture tests; the service rejects it.
  const router = pageServer();
  await listen(router, 80);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const success = await capturePort(browser, "127.0.0.1", 80);
    assert.equal(success.accessible, true);
    assert.equal(success.httpStatus, 200);
    assert.match(success.screenshot, /^data:image\/jpeg;base64,/);
    const failed = await capturePort(browser, "127.0.0.1", 8443);
    assert.equal(failed.accessible, false);
    assert.equal(failed.httpStatus, null);
    assert.match(failed.screenshot, /^data:image\/jpeg;base64,/);
    const image = Buffer.from(failed.screenshot.split(",")[1] || "", "base64");
    assert.equal(image.readUInt16BE(0), 0xffd8);
    assert.ok(image.length > 5000);
    assert.notEqual(failed.screenshot, success.screenshot);
    if (process.env.CAPTURE_TEST_DIR) {
      await writeFile(`${process.env.CAPTURE_TEST_DIR}/failed.jpg`, image);
      await writeFile(`${process.env.CAPTURE_TEST_DIR}/success.jpg`, Buffer.from(success.screenshot.split(",")[1] || "", "base64"));
    }
  } finally { await browser?.close(); await close(router); }
});

test("port 8080 is captured over HTTP and reports failure after both protocols", async () => {
  const router = pageServer();
  await listen(router, 8080);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const httpOnly = await capturePort(browser, "127.0.0.1", 8080);
    assert.equal(httpOnly.accessible, true);
    assert.equal(httpOnly.httpStatus, 200);
    await close(router);
    const closed = await capturePort(browser, "127.0.0.1", 8080);
    assert.equal(closed.accessible, false);
    assert.equal(closed.httpStatus, null);
    assert.match(closed.screenshot, /^data:image\/jpeg;base64,/);
  } finally { await browser?.close(); await close(router).catch(() => {}); }
});
