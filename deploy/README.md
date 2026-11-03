# Standalone deployment

This deployment path runs the app on Node.js and its own PostgreSQL-backed authentication/data stack on an Ubuntu 24.04 VM. A plain PostgreSQL installation is not sufficient: authentication, the data API and row-level security are required. Use the official compatible backend Docker stack referenced below. This repository does not vendor that stack or its secrets.

The hosted application is not switched to the VM by these files. Existing users, records and encrypted credentials are not automatically copied.

## What is included

- `vite.standalone.config.ts`: explicit Node server target; hosted target unchanged.
- `build:standalone`: isolates build variables from the exported hosted `.env`, validates destination/public key and records public build configuration.
- `start:standalone`: validates runtime secrets and refuses stale browser configuration.
- `db:migrate:standalone`: applies migrations 0000–0007 in journal order in one transaction; private checksum journal, repeat-safe and refuses untracked restored schemas. Adds the device identity-sequence privileges needed on fresh databases.
- `check:standalone`: checks auth reachability, table access, anonymous denial and administrator existence. No secret values are printed.
- systemd and Nginx examples; existing logo served locally at its original asset path.

## 1. Provision Ubuntu and the independent backend

Use Ubuntu 24.04 LTS with Docker Engine/Compose, Node **22.12+** and Bun. The backend alone documents minimum 4 GB RAM, 2 CPUs, 40 GB SSD; allocate additional capacity for app and Chromium (8 GB RAM/4 CPUs is a starting point, not a load-tested guarantee).

Follow the official backend Docker guide linked from https://docs.lovable.dev/tips-tricks/external-deployment-hosting. Select a reviewed release, keep its version/configuration backed up, generate fresh keys/passwords using its documented tools, and change all defaults. Do not use a development CLI stack as production. Keep its administrative console accessible only over SSH/VPN; expose only its API behind HTTPS.

Bind the backend HTTP gateway to **127.0.0.1:8000**. Do not publicly publish PostgreSQL, connection-pooler ports, Studio, analytics or Docker daemon ports. Docker-published ports can bypass UFW: review Compose port bindings as well as your firewall. Use two DNS names: the website and the backend API. `nginx.conf.example` contains illustrative domains, not your real addresses. Replace them and use Certbot or company-issued trusted TLS certificates before using sign-in.

Configure the backend's public API URL, authentication external URL, website URL and allowed redirects consistently. Public app callbacks: `https://YOUR-APP/auth` and `https://YOUR-APP/reset-password`. Configure SMTP with confirmations enabled; never enable anonymous signup. **Before opening signup publicly**, create and verify the intended first administrator on a restricted installation: the existing signup trigger grants the first account Admin. All subsequent accounts wait for an Admin-granted role. No accounts or passwords are shipped.

## 2. Configure private environment

Export source without `.env`, `.git`, dependencies or build output to `/opt/field-ops-console`. Keep the lockfile. Create a system account `fieldops-web` owning that source folder. Install Node at `/usr/bin/node` or adjust the service file.

```bash
sudo install -m 600 -o root -g root deploy/standalone.env.example /etc/field-ops-console.env
sudoedit /etc/field-ops-console.env
```

Fill every blank using your **new independently operated backend**. `VITE_SUPABASE_URL` is its public HTTPS API origin, `SUPABASE_URL` can be `http://127.0.0.1:8000`. Browser/server public keys must match; the server administrative key is separate and must never have a `VITE_` prefix. `STANDALONE_DATABASE_URL` is a private owner connection to its PostgreSQL database. Obtain it from your own stack, not Lovable Cloud. Use a randomly generated encryption secret of at least 32 characters (for example generate privately with `openssl rand -hex 32`). Treat the environment file as shell-compatible assignments when using the commands below; quote special characters. Do not print it.

For restored encrypted records, preserve the original `DB_SECRET_KEY` or securely re-enter credentials in a fresh installation. New keys do not decrypt old values. The Admin Settings alternate database form does **not** switch the app's main database.

## 3. Install, migrate and build

Run dependency installation as the website account, not root:

```bash
sudo -u fieldops-web bash -c 'cd /opt/field-ops-console && bun install --frozen-lockfile'
```

In a private root shell load `/etc/field-ops-console.env`, then pass the environment to the service account using a reviewed privilege switch. Do not put keys in shell arguments/history or use `sudo -E` with your whole interactive environment. One explicit pattern (run in the source directory) is:

```bash
sudo bash -c 'set -a; . /etc/field-ops-console.env; set +a; cd /opt/field-ops-console; runuser -u fieldops-web --preserve-environment -- bun run db:migrate:standalone'
sudo bash -c 'set -a; . /etc/field-ops-console.env; set +a; cd /opt/field-ops-console; runuser -u fieldops-web --preserve-environment -- bun run build:standalone'
```

The migration runner refuses a database with existing application tables and no deployment journal; reconcile a data restore separately, rather than rerunning CREATE statements over it. Never restore managed auth schemas blindly. Backups, auth/provider configuration, storage objects, data and encryption secrets require separate migration planning. Build **on the VM**, outside the Lovable sandbox. A Node-target production build has not been executed in this sandbox. Runtime public-value changes require a new standalone build.

## 4. Serve and install the helper

Install `deploy/field-ops-console.service` into `/etc/systemd/system`, update executable paths if necessary, then run `systemctl daemon-reload` and `systemctl enable --now field-ops-console`. Use the Nginx example, validate with `nginx -t`, enable HTTPS and verify certificate renewal. The app listens only on localhost:3000. Do not run `vite preview` as production.

Sign in to your new website as Admin and save Console Connect settings. Site ID Lookup and SIM Activation share these credentials. Console Connect must permit the VM's outbound public IP. Generate the Network Helper install command **from the new HTTPS website** and paste it on the Ubuntu VM with sudo. The helper stays a separate service and must have private-network/VPN routes to the routers; the web app never runs router jobs itself. Re-enroll against the new backend, not the hosted website. The installer requires outbound npm/Chromium downloads.

## 5. Okta

Use a compatible backend release **0.8.1 or later (Auth v2.196.0+)** supporting custom OIDC providers. Register **`custom:app-oidc`** using the backend's trusted Auth admin API (not merely the app's saved Okta form). Supply your exact Okta issuer, client ID/secret and scopes `openid`, `profile`, `email`. The backend Auth external URL must end in `/auth/v1`; register `https://YOUR-BACKEND/auth/v1/callback` in Okta. Do this using the official self-hosted custom-provider instructions; secrets must remain server-side. App-side Okta settings do not automatically create the provider.

## 6. Required acceptance checks

Run `bun run check:standalone` with the private environment loaded as above. Complete **all** of these on the actual VM before cutover:

- [ ] Node output exists; homepage/logo load through HTTPS and deep links refresh.
- [ ] First verified administrator, later restricted account, email confirmation/reset/sign-out and Okta return work.
- [ ] Admin Settings/helper are blocked for Non-Staff; anonymous access is blocked.
- [ ] Devices save and read back (identity sequence privileges), history reads back.
- [ ] Helper enrolls, heartbeat updates, settings arrive and `UR35_Credentials.txt` has mode 0600 and correct owner (never display its contents).
- [ ] Real private-IP ping/screenshots return and history saves.
- [ ] Console Connect test and a known Site ID lookup succeed from this VM.
- [ ] An authorized test SIM completes real activation/IP lookup and approved firewall/NTP jobs; simulated results do not count.
- [ ] Reboot recovery, certificate renewal, encrypted backups and a restore/rollback drill pass.

### Verification status

Deployment validation/unit tests and helper installer syntax are checked in the project. A local PostgreSQL migration exercise may validate SQL replay, but is not a full production authentication stack. The full Node production build, independent-backend sign-in, Okta, Console Connect and router/SIM flows must still be verified on your VM. No server access, data cutover or production readiness certification is implied.

### Sources

- https://docs.lovable.dev/tips-tricks/external-deployment-hosting
- Official backend Docker and custom OIDC instructions linked from that guide.
- https://nodejs.org/en/download
- https://bun.com/docs/installation

Keep backend, source, lockfile and OS updates reviewed and backed up. Do not change application migration files after they are applied; the deployment checksum guard will reject modified versions.