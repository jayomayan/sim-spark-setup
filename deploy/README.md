# Standalone deployment

**GCP Ubuntu VM, starting fresh:** follow [GCP-UBUNTU.md](GCP-UBUNTU.md) for networking, GitHub source download, independent backend, HTTPS, first admin and verification.

This deployment path runs the app and its PostgreSQL-backed authentication/data services directly on Ubuntu 24.04, using native packages/binaries and systemd. A plain PostgreSQL installation is not sufficient: compatible authentication, the data API and row-level security are required. The repository supplies both manual deployment tooling and an interactive fresh-VM installer.

**Interactive installer:** [INTERACTIVE-INSTALL.md](INTERACTIVE-INSTALL.md) covers `sudo python3 deploy/install-ubuntu.py`, which automates the native backend and app setup on a fresh Ubuntu 24.04 x86_64 VM. It remains unverified end-to-end on a target VM; use the manual requirements below as a compatibility reference.

The hosted application is not switched to the VM by these files. Existing users, records and encrypted credentials are not automatically copied.

## What is included

- `vite.standalone.config.ts`: standard Vite, TanStack Start, React, Tailwind and Nitro plugins with an explicit Node server target; hosted target unchanged.
- `dev:standalone`: independent local development with the same standard configuration and origin-local session persistence.
- `build:standalone`: isolates build variables from the exported hosted `.env`, validates destination/public key and records public build configuration.
- `start:standalone`: validates runtime secrets and refuses stale browser configuration.
- `db:migrate:standalone`: applies all checked-in migrations in journal order in one transaction; private checksum journal, repeat-safe and refuses untracked restored schemas. Adds the device identity-sequence privileges needed on fresh databases.
- `check:standalone`: checks auth reachability, table access, anonymous denial and administrator existence. No secret values are printed.
- systemd and Nginx examples; existing company logo served locally at `/media/fta-logo.png` without an asset-service request.

## 1. Provision Ubuntu and the independent backend

Use Ubuntu 24.04 LTS, native PostgreSQL, Node **22.12+** and Bun. Start with 8 GB RAM, 4 CPUs and 40 GB disk, with additional capacity for database growth, backups and Chromium; this is not a load-tested guarantee.

Install PostgreSQL through Ubuntu packages and enable its systemd service. Separately install compatible [Auth/GoTrue](https://github.com/supabase/auth) and [PostgREST](https://docs.postgrest.org/en/stable/references/install.html) native binaries, or compile reviewed releases following their upstream instructions. Run each as a dedicated unprivileged systemd service with private environment files. Review, pin and back up the releases and configuration. Do not use a development CLI stack as production.

The native backend must supply all of the following before app migrations run:

- Compatible backend roles (`anon`, `authenticated`, `service_role` and a REST authenticator), role switching and grants; initialize these using reviewed backend bootstrap SQL, not improvised app migrations.
- The managed `auth` schema, users, `auth.uid()` and `auth.role()` helpers expected by the checked-in migrations; Auth handles its own release-specific schema migrations.
- Auth endpoints under `/auth/v1`, including password login, refresh, account administration, password verification/recovery and the custom OIDC provider used for Okta.
- REST endpoints under `/rest/v1` with the `public` schema exposed, user JWTs applied to row-level security and the server administrative key accepted only for privileged operations.
- A compatible API gateway that validates public/server API keys and correctly routes Auth and REST requests. Merely proxying unconfigured binaries is not enough; never substitute the administrative key for a browser key.

**Stop here until these services are installed and verified.** The interactive installer downloads/verifies native tools and generates bootstrap roles, backend systemd units and gateway configuration. For a manual deployment, supply the same prerequisites yourself; installing PostgreSQL and running the app migration command alone does not complete them.

Bind that backend HTTP gateway to **127.0.0.1:8000**. Keep PostgreSQL and individual backend listeners on loopback or a restricted private interface; expose only the intended API through HTTPS. Keep administrative screens accessible only over SSH/VPN. Use two DNS names: the website and the backend API. `nginx.conf.example` contains illustrative domains, not your real addresses. Replace them and use Certbot or company-issued trusted TLS certificates before using sign-in.

Configure the backend's public API URL, authentication external URL, website URL and allowed redirects consistently. Public app callbacks: `https://YOUR-APP/auth` and `https://YOUR-APP/reset-password`. Configure SMTP with confirmations enabled; never enable anonymous signup. **Before opening signup publicly**, create and verify the intended first administrator on a restricted installation: the existing signup trigger grants the first account Admin. All subsequent accounts wait for an Admin-granted role. No accounts or passwords are shipped.

## 2. Configure private environment

Export source without `.env`, `.git`, dependencies or build output to `/opt/field-ops-console`. Keep the lockfile. Create a system account `fieldops-web` owning that source folder. Install Node at `/usr/bin/node` or adjust the service file.

```bash
sudo install -m 600 -o root -g root deploy/standalone.env.example /etc/field-ops-console.env
sudoedit /etc/field-ops-console.env
```

Fill every blank using your **new independently operated backend**. `VITE_SUPABASE_URL` is its public HTTPS API origin, `SUPABASE_URL` can be `http://127.0.0.1:8000`. Browser/server public keys must match; the server administrative key is separate and must never have a `VITE_` prefix. `STANDALONE_DATABASE_URL` is a private owner connection to its PostgreSQL database. Obtain it from your own stack, not the hosted environment. Use a randomly generated encryption secret of at least 32 characters (for example generate privately with `openssl rand -hex 32`). Treat the environment file as shell-compatible assignments when using the commands below; quote special characters. Do not print it.

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

The migration runner refuses a database with existing application tables and no deployment journal; reconcile a data restore separately, rather than rerunning CREATE statements over it. Never restore managed auth schemas blindly. Backups, auth/provider configuration, storage objects, data and encryption secrets require separate migration planning. Build **on the target VM**. A Node-target production build has not been executed in this development environment. Runtime public-value changes require a new standalone build.

## 4. Serve and install the helper

Install `deploy/field-ops-console.service` into `/etc/systemd/system`, update executable paths if necessary, then run `systemctl daemon-reload` and `systemctl enable --now field-ops-console`. Use the Nginx example, validate with `nginx -t`, enable HTTPS and verify certificate renewal. The app listens only on localhost:3000. Do not run `vite preview` as production.

Sign in to your new website as Admin and save Console Connect settings. Site ID Lookup and SIM Activation share these credentials. Console Connect must permit the VM's outbound public IP. Generate the Network Helper install command **from the new HTTPS website** and paste it on the Ubuntu VM with sudo. The helper stays a separate service and must have private-network/VPN routes to the routers; the web app never runs router jobs itself. Re-enroll against the new backend, not the hosted website. The installer requires outbound npm/Chromium downloads.

## 5. Okta

Use a compatible native Auth release **v2.196.0 or later** supporting custom OIDC providers, and verify that support in your selected release. Register **`custom:app-oidc`** using the backend's trusted Auth admin API (not merely the app's saved Okta form). Supply your exact Okta issuer, client ID/secret and scopes `openid`, `profile`, `email`. The backend Auth external URL must end in `/auth/v1`; register `https://YOUR-BACKEND/auth/v1/callback` in Okta. Do this using the official self-hosted custom-provider instructions; secrets must remain server-side. App-side Okta settings do not automatically create the provider.

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

The standalone configuration loads without importing the hosted configuration wrapper. All 108 application tests pass, including standalone origin-local session storage and deployment safeguards. The full Node output has not been built in this environment; running the VM build and acceptance checks below remains required. See [INDEPENDENCE-AUDIT.md](INDEPENDENCE-AUDIT.md) for the footprint inventory.

Deployment validation/unit tests, migration-runner behavior and helper installer syntax are checked in the project. Preview sign-in form, local logo and installer download were checked. A local PostgreSQL rehearsal could not start because the sandbox PostgreSQL installation lacks its snowball extension; no claim of SQL/database execution validation is made. The full Node production build, independent-backend sign-in, Okta, Console Connect and router/SIM flows must still be verified on your VM. No server access, data cutover or production readiness certification is implied.

### Sources

- https://www.postgresql.org/download/linux/ubuntu/
- https://github.com/supabase/auth
- https://docs.postgrest.org/en/stable/references/install.html
- https://supabase.com/docs/guides/auth
- https://nodejs.org/en/download
- https://bun.com/docs/installation

Keep backend, source, lockfile and OS updates reviewed and backed up. Do not change application migration files after they are applied; the deployment checksum guard will reject modified versions.