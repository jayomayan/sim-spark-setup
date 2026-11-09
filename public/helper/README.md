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
2. Copy `field-ops-helper.mjs`, `router-ssh.mjs` and `package.json` to the machine.
3. `npm install`, then `npx playwright install chromium` for the screenshot browser.
4. Start it with the console address and the helper key:

   ```sh
   CONSOLE_URL="https://your-console" AGENT_TOKEN="<helper key>" node field-ops-helper.mjs
   ```

   Keep it running with systemd or pm2 — a restart is how the helper applies an update.

The helper key is created by the console the first time an install command is
generated; **Admin Settings → Network Helper → Reset helper key** retires it.

## Safety

## Router SSH configuration

Firewall and NTP jobs use SSH port **22** through the on-network helper and the
ordered logins saved in Admin Settings. Only authentication rejection tries
another login; connection failures, changed host keys and command errors stop.
Enable SSH and remote SSH access on the router. The helper uses an interactive
UR-series CLI, not a Linux shell. No HTTPS or shell fallback is performed.

Paste the original `firewall access-control custom id ... rule ...` commands
into **Firewall commands applied during SIM activation**, one command per line.
Commands are sent as entered, preserving IDs and order. Bare iptables arguments
and arbitrary shell commands are not accepted. Existing rules are not cleared;
conflicting IDs stop before writes. Unsupported CLI commands stop the job.

NTP keeps the existing JSON editor format (`enabled`, `servers`, `timezone`).
The helper converts it to `clock timezone UTC+8`, `clock zonename Asia/Manila`,
`ntp server <primary>` and `ntp secondary-server <backup>` (or removes the backup).
It preserves the readable nonzero `ntp update-interval`, saves with `end` → `write`,
and requests `ntp sync`. It refuses disabled/unreadable NTP rather than inventing
an enable command. Only Asia/Manila and one or two servers are supported.

Firmware compatibility remains unverified: `show running-config` is probed
before any write; unsupported readback stops safely. Custom firewall syntax is
user-provided, not established by the official CLI guide. Errors after the first
write may leave partial changes; inspect the router before retrying. Readback
checks running settings, not restart persistence, packet flow or clock sync.
The first authenticated SSH host key is saved privately beside the helper;
subsequent changes require administrator inspection. Avoid concurrent GUI edits.
Release 1.9.1 appends the legacy `ssh-rsa` host signature for older UR35 firmware,
without changing modern key-exchange, cipher or MAC preferences. First-time
fingerprints are accepted automatically and saved only after successful login;
changed fingerprints remain blocked. Connection errors distinguish refused
ports, timeouts, algorithm negotiation and changed fingerprints.
Release 1.9.2 allows 30 seconds for the SSH login and reports whether port 22
gave no answer (SSH disabled or blocked on the cellular connection) or answered
but the login did not finish in time.

References:
- https://resource.milesight.com/milesight/iot/document/ur-series-cli-documentation-en.pdf
- https://resource.milesight-iot.com/document/CLI%20Commands-all.xlsx
- https://support.milesight-iot.com/support/solutions/articles/73000607107-how-to-access-the-command-line-interface-cli-

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
