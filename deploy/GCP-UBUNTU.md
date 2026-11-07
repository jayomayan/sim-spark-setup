# GCP Ubuntu VM: native installation

Deploy the GitHub source to your existing Ubuntu VM with a **new, independent database and sign-in service**. This guide starts fresh: it does not copy hosted users, passwords, records, or saved integration credentials, and does not modify the hosted app.

The application needs PostgreSQL **plus compatible authentication and data APIs**. Installing PostgreSQL alone or adding a connection in Admin Settings does not provide those APIs or switch the main database.

All services run directly on Ubuntu using native packages/binaries and systemd. **Interactive fresh installation:** use [INTERACTIVE-INSTALL.md](INTERACTIVE-INSTALL.md) to install the native backend and website together. The sections below are the manual installation reference.

## 1. Prepare GCP networking

- Use Ubuntu 24.04 LTS. Start with 4 vCPUs, 8 GB RAM and at least 40 GB disk; allocate more for database growth, backups and screenshot workloads. This is a starting size, not a tested capacity guarantee.
- Reserve a static external IP. Point two DNS names to it: one for the website and one for the backend API.
- Allow inbound TCP 80/443. Restrict SSH to your IP, or use GCP IAP with its documented firewall rules. Keep PostgreSQL, connection poolers and backend admin screens private.
- For private router access, establish company-network VPN/routes. A GCP VM cannot reach company private addresses just because both use private IPs. Check overlapping address ranges and return routes.
- Permit outbound HTTPS for Console Connect, package downloads and certificates. Use a stable outbound IP if Console Connect requires allowlisting.

Examples below use `ops.example.com` and `backend.example.com`; replace both with DNS names you control. Do not use sign-in over a bare public HTTP IP.

## 2. Install prerequisites and download your source

On the VM:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates unzip nginx certbot python3-certbot-nginx postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

Install Node **22.12 or newer in the Node 22 series** using a trusted installation method. Install Bun in a shared executable location accessible to `fieldops-web`; a personal home-directory installation will not work with the included hardened service configuration. If Node is not `/usr/bin/node`, change `ExecStart` in the service example.

```bash
node --version
bun --version
sudo systemctl is-active postgresql
sudo useradd --system --user-group --home-dir /opt/field-ops-console --shell /usr/sbin/nologin fieldops-web
```

Skip `useradd` if the account already exists. Authenticate to GitHub using a repository-scoped read-only deploy key or a trusted GitHub credential helper. Never embed a token in a clone URL. Replace the URL below with your own repository URL:

```bash
git clone YOUR_GITHUB_REPOSITORY_URL /tmp/field-ops-source
sudo install -d -o fieldops-web -g fieldops-web /opt/field-ops-console
sudo tar -C /tmp/field-ops-source --exclude=.git --exclude=.env --exclude='.env.*' \
  --exclude=node_modules --exclude=.output --exclude=dist --exclude=.tanstack \
  -cf - . | sudo tar -C /opt/field-ops-console -xf -
sudo chown -R fieldops-web:fieldops-web /opt/field-ops-console
```

The clone is a source staging folder only. Do not copy hosted environment files. Keep the repository lockfile and migration journal. Run the remaining app commands from `/opt/field-ops-console`.

## 3. Configure native authentication and data services

PostgreSQL is now installed, but the app still needs compatible Auth and REST services. Follow [the native backend requirements](README.md#1-provision-ubuntu-and-the-independent-backend): install reviewed GoTrue/Auth and PostgREST binaries (or compile reviewed releases) and run them as separate, unprivileged systemd services. Configure an API gateway on `127.0.0.1:8000` for the expected Auth and REST paths. Alternatively, the [interactive installer](INTERACTIVE-INSTALL.md) automates this setup on a fresh VM; do not mix it with a partially completed manual installation.

Before starting it:

1. Replace all default keys and passwords; keep them in root-only files outside the app repository.
2. Bind its HTTP gateway to `127.0.0.1:8000`. Bind PostgreSQL, Auth and REST listeners to loopback or a restricted private interface. Review GCP firewall rules as well as host firewall rules.
3. Set its public API origin to your backend HTTPS domain, its website URL to your app HTTPS domain and its Auth external URL to `https://YOUR-BACKEND/auth/v1`.
4. Allow the app's `/auth` and `/reset-password` callback URLs. Configure SMTP and email confirmations for account verification and password recovery. Do not enable anonymous signups.
5. Keep website signup restricted to the installer until the intended first administrator has been created and verified. The first signup receives Admin access.

Enable the native services at boot and verify their health, JWT/key compatibility and routing before continuing. Follow the selected releases' own native configuration instructions; do not use a local development CLI stack as a production backend. App migrations assume the backend roles and managed auth schema already exist and cannot bootstrap them.

## 4. Create the app's private environment

```bash
sudo install -m 600 -o root -g root deploy/standalone.env.example /etc/field-ops-console.env
sudoedit /etc/field-ops-console.env
```

Fill the file locally, never in GitHub or chat:

| Variable | Value from your fresh installation |
| --- | --- |
| `FIELD_OPS_STANDALONE` | `1` |
| `NODE_ENV` | `production` |
| `HOST`, `PORT` | `127.0.0.1`, `3000` |
| `VITE_SUPABASE_URL` | Public HTTPS backend API origin, with no path |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Backend public/anonymous key; never the administrative key |
| `SUPABASE_URL` | `http://127.0.0.1:8000` |
| `SUPABASE_PUBLISHABLE_KEY` | Same public key used above |
| `SUPABASE_SERVICE_ROLE_KEY` | Your independent backend's server-only administrative key |
| `DB_SECRET_KEY` | Fresh cryptographically random encryption secret, at least 32 characters |
| `STANDALONE_DATABASE_URL` | Private PostgreSQL owner connection for applying app migrations |

Generate secrets privately using a trusted password manager or the backend's tools. Keep assignments shell-compatible; quote special characters. Never use a `VITE_` prefix for a secret. Hosted managed administrative credentials are not available and must not be reused.

Use a private PostgreSQL connection reachable from the app process, normally through `127.0.0.1:5432` on this VM. Never open it publicly. Use a database owner account for migrations, not the browser's public API role.

## 5. Install dependencies, apply schema and build

```bash
sudo -u fieldops-web bash -c 'cd /opt/field-ops-console && bun install --frozen-lockfile'
sudo bash -c 'set -a; . /etc/field-ops-console.env; set +a; cd /opt/field-ops-console; runuser -u fieldops-web --preserve-environment -- bun run db:migrate:standalone'
sudo bash -c 'set -a; . /etc/field-ops-console.env; set +a; cd /opt/field-ops-console; runuser -u fieldops-web --preserve-environment -- bun run build:standalone'
```

The migration command reads all checked-in journal entries, including invitation and invitation-history tables. It is repeat-safe for tracked migrations and refuses an untracked restored application schema. Do not manually run individual SQL files or edit migrations after application.

The standalone build targets Node and isolates configuration from hosted `.env` files. Do not use the ordinary hosted build or `vite preview` for this deployment. Stop and resolve any failed command before continuing.

## 6. Start the website and enable HTTPS

```bash
sudo install -m 644 deploy/field-ops-console.service /etc/systemd/system/field-ops-console.service
sudo systemctl daemon-reload
sudo systemctl enable --now field-ops-console
sudo systemctl status field-ops-console --no-pager
sudo install -m 644 deploy/nginx.conf.example /etc/nginx/sites-available/field-ops-console
sudoedit /etc/nginx/sites-available/field-ops-console
```

Replace both example domains. Keep the backend administrative endpoints inaccessible publicly. If Nginx's default site conflicts, disable its symlink; preserve any unrelated websites already installed.

```bash
sudo ln -s /etc/nginx/sites-available/field-ops-console /etc/nginx/sites-enabled/field-ops-console
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d ops.example.com -d backend.example.com
sudo certbot renew --dry-run
```

Skip `ln -s` if the link already exists. Use your real domains in Certbot. Confirm HTTPS and backend API availability before sign-in. Keep bootstrap access restricted without preventing certificate validation or the backend-to-app requests your installation needs.

## 7. Create the first admin and configure operations

1. Create and verify your intended first account through the new website while bootstrap access remains restricted. It becomes Admin. The hosted admin account is **not** copied.
2. Sign in, confirm Admin Settings is accessible, and test that a later Non-Staff account cannot access it.
3. Re-enter Console Connect settings. Site ID Lookup and SIM Activation use the same configuration. Test the saved connection and a known Site ID from the VM.
4. If using Okta, follow [the standalone Okta section](README.md#5-okta) to configure the independent Auth provider and its callback; filling the app's Okta form alone does not enable sign-in.
5. In the new website's Admin Settings → Network Helper, generate its install command and run it with sudo on the machine that can reach your routers. This can be the GCP VM if VPN/routes are in place, or an on-network company server.
6. Re-enter router logins and firewall/NTP templates. Verify helper heartbeat and a safe private-IP connectivity check. Router work always runs through the helper.

Invitation contact details are stored, but the current invitation feature reports that invitation emails are not sent; configuring backend SMTP enables Auth mail, not automatic invitation notification emails. Admins can copy login details and share them privately; invited users must change the temporary password at first login.

## 8. Verify before opening access

```bash
sudo bash -c 'set -a; . /etc/field-ops-console.env; set +a; cd /opt/field-ops-console; runuser -u fieldops-web --preserve-environment -- bun run check:standalone'
```

Also complete the [acceptance checklist](README.md#6-required-acceptance-checks): HTTPS, deep-link refresh, first admin, restricted user access, invitation/password change, data save/readback, helper screenshots/ping and approved live SIM activation. For Router, verify IP lookup and firewall/NTP jobs; GPS does not apply router settings, and admin-only Other does not wait for IP.

Configure encrypted database/backups, preserve `DB_SECRET_KEY`, test restore and reboot recovery, and budget for GCP VM/disk/network costs. Do not treat a green web page as proof that all integrations work.

## Updates and troubleshooting

For updates, download a reviewed GitHub revision into a new staging folder, back up the database and encryption keys, stop the website briefly, copy only source files as above, reinstall locked dependencies, apply pending migrations, rebuild with the private environment, and restart. Keep the previous source/build for rollback; schema rollback needs a separate plan. Changes to public backend URL/key require rebuilding.

```bash
sudo journalctl -u field-ops-console -n 80 --no-pager
sudo nginx -t
sudo systemctl restart field-ops-console
```

Keep logs private and redact credentials before sharing. For a 502, check the website service and localhost port 3000. For sign-in failures, check HTTPS, public backend origin, keys, allowed redirects and SMTP. For private-IP failures, check helper status and VPN routing. For Console Connect failures, check outbound DNS/HTTPS and any provider allowlist.

**Verification limit:** these instructions are added to the source repository, not executed on your VM. The full standalone build, fresh backend/auth setup and live integrations still require the VM acceptance checks above.