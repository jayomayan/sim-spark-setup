import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright";
import { capturePort } from "./server.mjs";

test("captures a responding page and a real inaccessible-port screenshot", async () => {
  // Loopback is used only for isolated capture tests; the service rejects it.
  const router = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<h1>Router test page</h1>"); });
  await new Promise((resolve, reject) => { router.once("error", reject); router.listen(80, "127.0.0.1", resolve); });
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
    const page = await browser.newPage();
    await page.goto(failed.screenshot);
    assert.equal(await page.locator("img").evaluate("image => image.naturalWidth"), 1024);
    assert.equal(await page.locator("img").evaluate("image => image.naturalHeight"), 768);
    assert.ok(Buffer.from(failed.screenshot.split(",")[1] || "", "base64").length > 5000);
  } finally { await browser?.close(); await new Promise((resolve) => router.close(resolve)); }
});