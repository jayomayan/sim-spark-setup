# Frontier Site Connectivity Check screenshot service

Run this dedicated service on a Linux machine on the router network. It does not use the Field Ops helper or job queue. The hosted app cannot reach private routers directly.

## Install
1. Install Node.js 22 or newer and Linux `iputils-ping` (on Debian/Ubuntu: `sudo apt-get install iputils-ping`). Extract the service download, including `ping.mjs` and `ping.test.mjs`, into one folder.
2. In that folder run `npm install`, then `npx playwright install --with-deps chromium`.
3. Configure the following environment variables through your service manager or an untracked, owner-readable environment file:
   - `SERVICE_TOKEN`: a strong shared key of at least 32 characters. Use the same value for the app's `SITE_CONNECTIVITY_SERVICE_TOKEN` secret. Never put it in a URL or source control.
   - `ALLOWED_CIDRS`: comma-separated actual router ranges, such as `10.194.72.0/24`. This example is not your confirmed network range. Do not allow unrelated infrastructure.
   - `LISTEN_HOST`: defaults to `127.0.0.1`.
   - `PORT`: defaults to `8090`.
4. Run `npm test`, then `npm start`. Run as a dedicated non-root account with no router credentials or sensitive host files. Configure automatic restart with systemd or your service manager.

## Connect securely
- Expose only this local service through a company-approved HTTPS reverse proxy or outbound tunnel. Keep its listening port closed to inbound public connections. Configure the proxy to allow only `/capture`, `/ping` and `/health`, limit bodies to 1 KB and add rate limits. Do not log the Authorization header.
- In the app's secrets, set `SITE_CONNECTIVITY_SERVICE_URL` to the real HTTPS service base address (no `/capture` suffix), and `SITE_CONNECTIVITY_SERVICE_TOKEN` to the same shared key.
- Console Connect Site ID lookup separately requires the existing `AERIS_USERNAME` and `AERIS_PASSWORD` secrets. Without them, direct IP browsing still works once the service is connected.
- The service needs outbound access only to your approved router CIDRs on TCP ports 80, 443, 8443 and 8080 plus ICMP echo requests/replies for ping. Enforce that independently in your host/container firewall, deny other destinations and UDP, and deny access to cloud metadata and other host services. Browser URL filtering is an additional guard, not a replacement for network isolation. Ensure your non-root service account can run `ping` using your system's ICMP permissions; do not run the entire service as root.
- Publish the app after changing secrets if you want those changes on a published version.

## Behavior
`POST /capture` accepts exactly `{ "ip": "10.194.72.40", "port": 80 }` with `Authorization: Bearer <shared key>` and `Content-Type: application/json`. Only ports 80 (HTTP), 443 (HTTPS), 8443 (HTTPS) and 8080 (HTTP first, then HTTPS when the device answers that way) are allowed. Redirects/resources are limited to the same target IP and those ports. Router self-signed certificates are accepted. Login pages and HTTP error pages count as browsable if an HTTP response arrives; HTTP status is returned. No credentials are entered and no router settings are changed.

Each request uses a fresh browser context. Successful responses include a 1024 × 768 JPEG data URL; unsuccessful navigation returns a real screenshot saying `Not able to access Port XX`. Service/authentication/configuration errors are separate errors, never false port failures. Screenshots are not stored on disk or in the app database. Four captures may run at once; excess requests or more than 30 requests per minute receive HTTP 429.

Authenticated `GET /health` reports service readiness. A working local health check does not prove the hosted app can reach the HTTPS address; test the app after deployment.

`POST /ping` accepts exactly `{ "ip": "10.194.72.40" }` with the same authentication and CIDR restrictions. It sends four ICMP probes with a ten-second deadline and returns reachability, transmitted/received counts, packet-loss percentage, and minimum/average/maximum round-trip milliseconds. No replies does not prove the router is offline: ICMP may be blocked while web ports remain accessible. Installation, permission, and service errors are separate from no-reply results. One ping and four captures may run concurrently; all requests share the 30-per-minute rate limit. Updating an existing installation requires the new files, an updated proxy allowlist, and restarting the service.