# Field Ops Helper

A small program that runs on a machine inside your network (one that can reach
the router IPs, directly or over VPN). It asks the console for work, does it
locally, and reports back. No inbound ports are needed — it only makes outgoing
HTTPS calls to the console.

It handles every router job in the app:

- **Site Connectivity Check** — screenshots of ports 80, 443, 8443 and 8080
  (8080 is tried over HTTP then HTTPS) plus the four-probe ping test.
- **Ping, SNMP walk, device NTP, UR35 firewall and NTP** for the other tools.

## Install (recommended)

Open **Admin Settings → Network Helper**, press **Create install command**, and
paste the command on the machine over SSH. It installs the tools the helper
needs, downloads the program, saves the key, and starts it as a service:

```sh
curl -fsSL https://your-console/helper/install.sh \
  | sudo bash -s -- --console https://your-console --code <one-time code>
```

The install code works once and expires after 30 minutes. The helper then pulls
the router login and the firewall/NTP templates from the console, and downloads
newer releases on its own — there is nothing to reinstall later.

`--node-scripts /path/to/node-scripts` copies the device-NTP scripts from your
old app. `--skip-deps` skips the dependency step for offline machines.
To remove everything: `curl -fsSL https://your-console/helper/uninstall.sh | sudo bash`.

## Install by hand

1. Install **Node.js 18+** and the `snmpwalk` and `ping` tools
   (`sudo apt install snmp iputils-ping` on Debian/Ubuntu).
2. Copy `field-ops-helper.mjs` and `package.json` to the machine.
3. `npm install`, then `npx playwright install chromium` for the screenshot browser.
4. Copy the `node-scripts` folder from your old app next to
   `field-ops-helper.mjs` (or set `NODE_SCRIPTS_DIR`) and run `npm install` there.
5. Start it with the console address and the helper key:

   ```sh
   CONSOLE_URL="https://your-console" AGENT_TOKEN="<helper key>" node field-ops-helper.mjs
   ```

   Keep it running with systemd or pm2 — a restart is how the helper applies an update.

The helper key is created by the console the first time an install command is
generated; **Admin Settings → Network Helper → Reset helper key** retires it.

## Safety

- Only private RFC1918 IPs are touched, and screenshots are limited to ports
  80, 443, 8443 and 8080 on the exact IP requested — the browser cannot follow
  redirects or load anything from another address.
- Screenshots are sent straight back to the console; nothing is kept on disk.
- The helper key is stored in `/etc/field-ops-helper.env`, readable by root only.
- Updates come from the console's own address over HTTPS and are syntax-checked
  before the running copy is replaced.
