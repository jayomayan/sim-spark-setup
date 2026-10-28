# Rebuild "Private Browser" as a new app, with SIM Activation added

## What you get
A new app with a fresh, dark operations-console design. It keeps every screen your current app has and adds SIM Activation:

1. **Sign in**: Okta for internal staff, email and password for external users. Existing users verify their email and choose a new password the first time they sign in.
2. **Dashboard**: device counts, recent activity and shortcuts.
3. **SIM Activation** (new): enter an ICCID, activate it through IoT Console Connect, wait for the IP, show Active and the IP, apply firewall rules to the UR35, apply NTP settings, done. Each run is saved to a history.
4. **Private Browser**: look up a site ID (PH…) through Aeris or a private IP, check the router is reachable, and show device info.
5. **Devices**: list, search, add, edit and delete devices, including site ID, serial number and firmware versions. Download devices and logs as CSV, and pull logs from a router.
6. **SNMP Walk**: run OIDs against a device and see the results.
7. **Device NTP**: push NTP settings to one router or several.

## How router work happens (the helper)
The new app runs online. A small helper program runs on any machine inside your network that can reach the routers today, for example your current server.
- The helper connects out to the app, so you don't need to open any ports in your firewall.
- The app queues jobs such as ping, SNMP walk, applying firewall or NTP settings, or downloading logs. The helper picks them up, does the work and reports results back to the app.
- A status light in the app shows whether the helper is online.
- I'll give you the helper as a download, with simple steps to install it and a secret key that links it to the app.

## Your data
Devices, device logs and users move to Lovable Cloud. After the rebuild I'll ask you to export them from your current database (CSV), then I'll import them.

## What I'll ask for later, in secure forms
- Okta domain, client ID and client secret
- IoT Console Connect / Aeris API credentials
- UR35 router login
- BigQuery details, if you still want log data sent there

## Order of work
1. Turn on Lovable Cloud, then set up the design, sign-in and the app layout with navigation.
2. Build Devices and device logs, including CSV export.
3. Build the job queue and the helper program.
4. Rebuild Private Browser, SNMP Walk and Device NTP so they use the helper.
5. Move SIM Activation into the new app and connect its router steps to the helper.
6. Test everything in the preview, then import your data.

## Technical details
- Tables: devices (ip unique, name, site_id, serial_number unique, arm/stm32/web/kernel/mib versions, last_log_pulled_at), device_logs (ip, site_id, date, time, event, message; unique on ip+date+time+message), sim_activations, agent_jobs (type, payload, status, result), profiles, user_roles.
- The helper is a Node script. It polls a secured server route with a shared secret and runs ping, snmpwalk, HTTPS calls to the routers and the existing log and NTP scripts.
- Okta sign-in uses OIDC via Cloud auth (SSO), if it's available on this plan. Otherwise it uses a server-side OIDC flow.
