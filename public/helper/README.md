# Field Ops Helper

A small program that runs on a machine inside your network (one that can reach
the router IPs, directly or over VPN). It asks the console for work, does it
locally, and reports back. No inbound ports are needed — it only makes outgoing
HTTPS calls to the console.

It handles every router job in the app:

- **Site Connectivity Check** — screenshots of ports 80, 443, 8443 and 8080
  (8080 is tried over HTTP then HTTPS) plus the four-probe ping test.
- **Ping, SNMP walk, UR35 firewall and NTP** for the other tools.

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

`--skip-deps` skips the dependency step for offline machines.
To remove everything: `curl -fsSL https://your-console/helper/uninstall.sh | sudo bash`.

## Install by hand

1. Install **Node.js 18+** and the `snmpwalk` and `ping` tools
   (`sudo apt install snmp iputils-ping` on Debian/Ubuntu).
2. Copy `field-ops-helper.mjs` and `package.json` to the machine.
3. `npm install`, then `npx playwright install chromium` for the screenshot browser.
4. Start it with the console address and the helper key:

   ```sh
   CONSOLE_URL="https://your-console" AGENT_TOKEN="<helper key>" node field-ops-helper.mjs
   ```

   Keep it running with systemd or pm2 — a restart is how the helper applies an update.

The helper key is created by the console the first time an install command is
generated; **Admin Settings → Network Helper → Reset helper key** retires it.

## Safety

## Router HTTPS configuration

Firewall and NTP use the Milesight UR-series HTTPS `/cgi` API on ports **443 and
8443**: login tries 443 first and falls back to 8443 on a connection failure or
timeout. Saved Admin Settings logins are tried in order before any settings write.
Incorrect credentials (`status: -1`) allow the next login on that port;
restrictions, rejected HTTP requests and unsupported responses stop the job.
All reads, writes, Apply and verification stay on the successfully authenticated
port; failed configuration requests are never replayed on another port.
Read-write API permission is required.

Paste the original `firewall access-control custom id ... rule ...` commands
into **Firewall commands applied during SIM activation**, one command per line.
The helper removes the CLI prefix, retains the IDs and order, and adds `-t nat`
to POSTROUTING/PREROUTING commands that omit a table. Bare iptables rule arguments
are also accepted; JSON is not the editor format. Existing router rules are
preserved, conflicting IDs stop the job, and the full merged list is read back.

NTP keeps the existing JSON editor format (`enabled`, `servers`, `timezone`).
The documented API supports one primary and one secondary server; more than two
servers or disabled mode stop safely rather than guessing firmware behavior.
Asia/Manila maps to `UTC+8 Asia/Manila`; other zones must already match the router.
Existing synchronization interval and NTP server-mode values are preserved.

Compatibility is based on the published UR-series API (UR35 `35.3.0.12-a1`
examples) and router-family AES login parameters. Unsupported firmware stops
without falling back to SSH or the old assumed Basic-auth endpoints. No live
router has been tested. Read-back verifies saved configuration, not packet flow
or actual clock synchronization. Required reboot/reconnect is reported as
unfinished; the helper never automatically reboots the router. Global Apply can
also apply unrelated changes staged in the router GUI, so avoid concurrent edits.

References:
- https://resource.milesight.com/milesight/iot/document/ur-series-http-api-documentation-en.pdf
- https://resource.milesight.com/milesight/iot/document/ur35-user-guide-en.pdf
- https://support.milesight-iot.com/support/solutions/articles/73000664027-how-to-use-milesight-router-opencpu-system-http-api
- https://cuberk.com/blog/inside-the-router-how-i-accessed-industrial-routers-and-reported-the-flaws/

## Safety details

- Only private RFC1918 IPs are touched, and screenshots are limited to ports
  80, 443, 8443 and 8080 on the exact IP requested — the browser cannot follow
  redirects or load anything from another address.
- Screenshots are sent straight back to the console; nothing is kept on disk.
- The helper key is stored in `/etc/field-ops-helper.env`, readable by root only.
- Each settings refresh replaces `UR35_Credentials.txt` beside the helper program
  (default `/opt/field-ops-helper/UR35_Credentials.txt`). It contains plaintext
  `username password` pairs, one per line, in saved order; only the helper account
  can read/write it (mode 0600, root can also access it). Removing all logins clears
  the file. Keep this file out of shared folders and backups accessible to others.
  The console still stores the passwords encrypted and never sends them to the browser.
- Updates come from the console's own address over HTTPS and are syntax-checked
  before the running copy is replaced.
