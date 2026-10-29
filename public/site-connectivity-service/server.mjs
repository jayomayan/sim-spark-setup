import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { allowedRequest, allowedTarget, parseCidrs } from "./policy.mjs";
import { pingTarget } from "./ping.mjs";

export async function capturePort(browser, ip, port) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, ignoreHTTPSErrors: true, serviceWorkers: "block", acceptDownloads: false });
  try {
    await context.route("**/*", (route) => allowedRequest(route.request().url(), ip) ? route.continue() : route.abort());
    await context.routeWebSocket("**/*", (socket) => socket.close());
    let page = await context.newPage();
    page.on("popup", (popup) => void popup.close());
    page.on("dialog", (dialog) => void dialog.dismiss());
    page.on("download", (download) => void download.cancel());
    let accessible = false, httpStatus = null;
    try {
      const response = await page.goto(`${port === 80 ? "http" : "https"}://${ip}:${port}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
      httpStatus = response?.status() ?? null;
      // Login/forbidden pages are browsable; a responding HTTP server is accessible.
      accessible = response !== null && allowedRequest(page.url(), ip);
      if (accessible) await page.waitForTimeout(1000);
    } catch { /* A failed navigation receives a real failure screenshot below. */ }
    if (!accessible) {
      await page.close();
      page = await context.newPage();
      await page.setContent(`<html><head><style>:root{--background:#fff;--foreground:#303030;--primary:#B0262D;--muted:#686868}body{margin:0;background:var(--background);color:var(--foreground);font-family:Arial,sans-serif;display:grid;place-items:center;height:100vh}.message{text-align:center}h1{font-size:32px;color:var(--primary)}p{font-size:20px;color:var(--muted)}</style></head><body><div class="message"><h1>Not able to access Port ${port}</h1><p>${ip}</p></div></body></html>`);
    }
    const image = await page.screenshot({ type: "jpeg", quality: 70, timeout: 5000, animations: "disabled" });
    return { port, accessible, httpStatus, screenshot: `data:image/jpeg;base64,${image.toString("base64")}` };
  } finally { await context.close(); }
}

export async function startService({ token, cidrs, host = "127.0.0.1", port = 8090 }) {
  if (!token || token.length < 32) throw new Error("SERVICE_TOKEN must contain at least 32 characters");
  const allowed = parseCidrs(cidrs);
  const browser = await chromium.launch({ headless: true, args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-quic"] });
  let active = 0, activePing = 0, calls = 0, windowStart = Date.now();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    const reply = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    const received = Buffer.from(req.headers.authorization ?? ""), expected = Buffer.from(`Bearer ${token}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) { reply(401, { error: "Unauthorized" }); return; }
    if (req.url === "/health" && req.method === "GET") { reply(browser.isConnected() ? 200 : 503, { ready: browser.isConnected() }); return; }
    const isPing = req.url === "/ping";
    if ((!isPing && req.url !== "/capture") || req.method !== "POST") { reply(404, { error: "Not found" }); return; }
    if (Date.now() - windowStart >= 60_000) { calls = 0; windowStart = Date.now(); }
    if ((isPing ? activePing >= 1 : active >= 3) || calls >= 30) { reply(429, { error: "Busy" }); return; }
    calls++; if (isPing) activePing++; else active++;
    try {
      if (!req.headers["content-type"]?.startsWith("application/json")) { reply(415, { error: "JSON required" }); return; }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024) { reply(413, { error: "Request too large" }); return; }
      }
      let input;
      try { input = JSON.parse(body); } catch { reply(400, { error: "Invalid JSON" }); return; }
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",") !== (isPing ? "ip" : "ip,port")) { reply(400, { error: "Invalid target" }); return; }
      if (!allowedTarget(input.ip, isPing ? 80 : input.port, allowed)) { reply(403, { error: "Target not allowed" }); return; }
      const result = isPing ? await pingTarget(input.ip) : await capturePort(browser, input.ip, input.port);
      reply(200, result);
    } catch { if (!res.headersSent) reply(503, { error: isPing ? "Ping unavailable" : "Capture unavailable" }); }
    finally { if (isPing) activePing--; else active--; }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  return { server, close: async () => { await new Promise((resolve) => server.close(resolve)); await browser.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startService({ token: process.env.SERVICE_TOKEN, cidrs: process.env.ALLOWED_CIDRS || "", host: process.env.LISTEN_HOST || "127.0.0.1", port: Number(process.env.PORT || 8090) })
    .then(({ close }) => { console.log("Site Connectivity Check screenshot service ready"); for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void close().then(() => process.exit(0))); })
    .catch(() => { console.error("Screenshot service could not start. Check configuration and Chromium installation."); process.exit(1); });
}