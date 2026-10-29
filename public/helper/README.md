# Field Ops Helper

A small program that runs on a machine inside your network (one that can reach
the router IPs, directly or over VPN). It asks the console for work, does it
locally, and reports back. No inbound ports are needed — it only makes outgoing
HTTPS calls to the console.

It handles every router job in the app:

- **Site Connectivity Check** — screenshots of ports 80, 443, 8443 and 8080
  (8080 is tried over HTTP then HTTPS) plus the four-probe ping test.
- **Ping, SNMP walk, device NTP, UR35 firewall and NTP** for the other tools.

## Setup

1. Install **Node.js 18+** and the `snmpwalk` and `ping` tools
   (`sudo apt install snmp iputils-ping` on Debian/Ubuntu).
2. Copy this folder to the machine.
3. Install the screenshot browser:
   ```sh
   npm install
   npx playwright install --with-deps chromium
   ```
4. Copy the `node-scripts` folder from your old app next to
   `field-ops-helper.mjs` (or set `NODE_SCRIPTS_DIR`) and run `npm install`
   there — needed for the Device NTP tool.
5. Set the environment variables and start it:

   ```sh
   export CONSOLE_URL="https://your-app.lovable.app"
   export AGENT_TOKEN="<the helper key from the console's Helper page>"
   export UR35_USERNAME="..."   # only for SIM activation router steps
   export UR35_PASSWORD="..."
   node field-ops-helper.mjs
   ```

   Keep it running with systemd, pm2, or a scheduled task.

## Safety

- Only private RFC1918 IPs are touched, and screenshots are limited to ports
  80, 443, 8443 and 8080 on the exact IP requested — the browser cannot follow
  redirects or load anything from another address.
- Screenshots are sent straight back to the console; nothing is kept on disk.
- The helper key (`AGENT_TOKEN`) is a shared secret; keep it in the
  environment, not in scripts.
