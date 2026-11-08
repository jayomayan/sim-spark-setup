# Interactive Ubuntu installation

The installer uses your existing PostgreSQL and runs the website, Auth, PostgREST and Nginx directly on Ubuntu as native services. It obtains HTTPS certificates, generates private keys on the VM, applies the checked-in application migrations and creates the first administrator through the sign-in service. It does not copy hosted users or data or create PostgreSQL clusters.

## Before starting

- Use an **Ubuntu x86_64 server with systemd**, either new or already hosting Nginx websites. There is no specific Ubuntu version gate; package/runtime compatibility still needs checking. Allow approximately 4 vCPUs, 8 GB RAM and 40 GB disk (at least 12 GB free), plus capacity for your existing apps. This is not a tested capacity guarantee.
- Point **two distinct DNS hostnames** at its static public IP: website and backend API.
- Allow inbound 80/443 in GCP; restrict SSH to your IP or IAP. Do not open database or internal service ports.
- Have working SMTP hostname, submission port, username, password and sender address. Email confirmation and password recovery require SMTP. SMTP setup does not enable invitation notification emails in the app.
- Clone a reviewed revision of your repository using your existing GitHub access. Do not embed access tokens in repository URLs or copy hosted `.env` files.
- Back up existing websites, databases and Nginx settings first. Existing PostgreSQL clusters and global Node/Bun installations are left in place. Existing Field Ops destinations are still refused; this is not an upgrade or restore tool. Dormant, locked, dedicated Field Ops service accounts can be reused with your explicit confirmation; their settings are not changed.
- PostgreSQL must already be installed and running locally on **5432**, accepting local administrator access as the `postgres` OS user and TCP connections on `127.0.0.1`. The installer checks this before making changes; it does not install server packages, start/restart PostgreSQL or change its configuration. On a new VM, install PostgreSQL separately first.

### Sharing a server

If installation reports that a service account already exists, use the updated installer from your reviewed checkout and rerun `sudo python3 deploy/install-ubuntu.py`. It checks for a locked password, no-login shell, expected home, dedicated group and no running processes before offering reuse. Interactive accounts, shared groups or active accounts are refused with the account name. Do not delete users or change their permissions to bypass the checks. Existing app files, keys or database state remain protected; partial installation recovery is not automated.

- Supply two **unused hostnames**. The installer checks existing Nginx names/patterns and refuses conflicts.
- It asks for four private service ports and suggests unused values. Defaults are website `3000`, gateway `8000`, Auth `9999`, and REST `3001`; occupied defaults are skipped and duplicate choices rejected. PostgreSQL uses the existing service on **5432**, without a database-port prompt.
- It creates only the **`fieldops` database and required backend roles** in existing PostgreSQL. Existing databases and PostgreSQL settings stay unchanged. If `fieldops` or any required role already exists, installation stops without reusing or overwriting it. Other clusters left by earlier attempts are ignored, not deleted or started.
- Node and Bun stay under `/opt/field-ops-backend`, not global executable paths. Existing runtime versions remain unchanged.
- Existing Nginx websites stay enabled. Only new Field Ops configuration is added, then Nginx is checked and gracefully reloaded. Certificates use webroot validation rather than a tool that edits existing sites.
- If Apache, Caddy or another server owns 80/443, installation stops before package changes. Arrange an Nginx reverse proxy with your server administrator first; the installer will not stop that website or take over its ports.
- Ubuntu package installation is host-wide: missing prerequisites and dependencies may be installed. Existing requested packages are not deliberately upgraded, and automatic restart of unrelated services is suppressed. Review a maintenance window nonetheless; sharing a host is not a guarantee of zero impact.

## Run from your repository checkout

Preview the questions with no changes:

```bash
python3 deploy/install-ubuntu.py --dry-run
```

Install on the target VM:

```bash
sudo python3 deploy/install-ubuntu.py
```

Answer the prompts for website/API hostnames, administrator email and strong password, SMTP settings, first-admin email verification and private service ports. Password prompts are hidden. No passwords or private keys are printed or passed in command arguments. Confirm the final summary to begin. Downloads/builds can take several minutes; a failed step stops installation. Dry run only previews questions; it does not prove that the target server is compatible.

The installer keeps public signup disabled: admins invite subsequent users. Email auto-confirmation remains off. If you decline the explicit first-admin verification question, the installer sends a confirmation email; verify delivery before use. It never sends the administrator password by email.

## What is installed

- A new `fieldops` database and separate Auth/REST roles in your existing local PostgreSQL on 5432; no new clusters.
- Auth `v2.196.0`, compiled from a pinned upstream commit using verified Go `1.26.5`; PostgREST `v16.5`.
- Verified private Node `22.22.0` and Bun `1.3.3`; the app's locked dependencies and standalone Node build.
- Separate `field-ops-auth`, `field-ops-rest`, and `field-ops-console` systemd services, with localhost-only listeners.
- Nginx website/API configuration, restricted API key routing, browser-origin allowance and trusted HTTPS certificates with renewal timer.
- Private settings in `/etc/field-ops/` and `/etc/field-ops-console.env`. Keys are generated locally; the website receives only the anonymous public key. Signed API keys expire after ten years and must be rotated before expiry (rotation requires rebuilding the website).

The Auth and REST environment files use systemd quoting, not shell expansion; do not source them in a shell. A temporary migration administrator is disabled after schema setup and removed on success; no superuser password is persisted in the website environment. On failure, preserve the private state and review any remaining disabled migration role locally.

Upstream GitHub binary downloads require a published SHA-256 digest; the installer stops if one is unavailable or mismatched. Node's checksum list is fetched from its HTTPS release origin; Go uses a pinned checksum. The Auth source commit is pinned and Go dependencies are verified. Review pinned versions before production use; changing versions requires another compatibility review.

## After installation

1. Open your HTTPS website and sign in as the first administrator. Confirm the email first if requested.
2. Re-enter and test Console Connect credentials in Admin Settings. Configure the independent Okta sign-in provider separately; saved app settings alone do not enable it.
3. Enroll the Network Helper through Admin Settings on a machine with access to your routers. The installer does not assume the GCP VM has company-network routes or silently deploy a helper to the wrong network.
4. Complete [the acceptance checklist](README.md#6-required-acceptance-checks): password login/change/recovery, member restrictions, saved records, helper ping/screenshots, and approved live SIM/router operations.
5. Configure encrypted backups and test restore, reboot recovery and certificate renewal. Keep database backups and encryption/signing secrets together securely.

## If installation stops

### Step 4: Auth migration denied access to public

The sign-in migration runner creates its tracking table without a schema qualifier. The updated installer sets a database-specific search path of `auth, public` for the Auth role, retaining the restriction on creating objects in `public`. It also installs `pgcrypto` in `fieldops`, required for UUID defaults on PostgreSQL 12. Neither change modifies other databases, starts clusters or changes PostgreSQL server configuration.

For an earlier partial installation, only after confirming that `fieldops` and its Auth role/schema exist, Auth has no tables, and database login works, apply this scoped repair as the local database administrator:

```bash
sudo -u postgres psql -X -p 5432 -d fieldops -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
ALTER ROLE supabase_auth_admin IN DATABASE fieldops SET search_path = auth, public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
COMMIT;
SQL
```

Preserve the existing keys, settings and database; do not rerun the fresh installer over this partial state. This repair is not an installation-resume command. Verify the Auth migration separately before planning continuation. Do not make the private environment file readable by other users or source it in a shell.

### Continue after successful Auth setup

From an updated reviewed source checkout, use:

```bash
sudo python3 deploy/install-ubuntu.py --resume-after-auth
```

Use your separately installed newer Python executable if the system Python is too old. This mode only accepts `status: installing`, completed Auth tables with no users or application tables, absent REST/app settings, and no later service/Nginx/certificate outputs. It validates saved ports, native tools, dedicated accounts and private file ownership, and refuses occupied ports or conflicting websites. It uses the application source already copied under `/opt/field-ops-console`; updating the checkout does not replace that source.

The command asks again for the first administrator email/password and email-verification choice. It retains Auth settings, SMTP credentials and the existing signing key; creates a private database backup; replaces only the unsaved REST-role password; and continues steps 5–8. It does not recreate the database, download tools or compile Auth again. Any later failure preserves partial state and requires another review, not another automatic rerun. Live VM completion remains unverified.

No automatic rollback deletes database records or keys. Preserve partial state and inspect the services privately:

Older installers may have left a separate `fieldops` cluster and partial application folders. The current installer does not need that cluster and will not modify or remove it. Preserve partial state; do not delete databases or rerun over existing application folders. Recovery requires checking what the earlier attempt created first.

For failure during step 2, first run the updated installer's **read-only** report from your reviewed source checkout:

```bash
sudo python3 deploy/install-ubuntu.py --diagnose
```

It displays Python compatibility and whether known installation paths exist, without opening secret settings, prompting for credentials or changing anything. Share only this report and the last progress lines. The installer now identifies unexpected failures by setup phase, exception type and source line, without exposing the error's potentially sensitive contents. Python safe-extraction support is checked before any installation writes; an older Python is one possible cause of failure during tool extraction, not a confirmed diagnosis of earlier runs.

```bash
sudo systemctl status field-ops-auth field-ops-rest field-ops-console --no-pager
sudo journalctl -u field-ops-auth -u field-ops-rest -u field-ops-console -n 80 --no-pager
sudo nginx -t
```

Do not share raw logs or secret files. Do not delete `/etc/field-ops` or the database to force a rerun. Diagnose an unsuccessful installation without changing unrelated websites or databases. For a completed installation, use [the interactive app upgrade script](UPGRADE.md), not the installer; it uses the saved database port and private runtimes and preserves settings. Older installations retain their previous defaults.

### Starting over completely

When a partial or failed installation should be abandoned rather than continued, run from your reviewed source checkout:

```bash
sudo python3 deploy/install-ubuntu.py --restart-clean
```

It lists what it will remove and requires typing `RESTART` to confirm. It stops and removes the three Field Ops services, removes only the Field Ops Nginx site and key map, deletes the `field-ops-native` certificate if one was issued, drops the `fieldops` database and the installer-created roles from local PostgreSQL, and moves the remaining folders (`/opt/field-ops-console`, `/opt/field-ops-backend`, `/etc/field-ops`, `/etc/field-ops-console.env`) into a timestamped backup under `/var/backups/` instead of deleting them. Service accounts are kept for safe reuse; other websites, databases, clusters and the existing PostgreSQL installation are untouched. Afterwards a fresh `sudo python3 deploy/install-ubuntu.py` run is accepted again.

**Verification status:** prompt, port selection, conflicting web server/hostname refusal, dedicated database targeting and secret-handling checks are included in `test_install_ubuntu.py`. Complete new/shared Ubuntu server installation, existing-site continuity, SMTP delivery, production build, Okta and real integrations have not been exercised here. This script is a deployment starting point, not a production-readiness certification.
### Continuation stopped with `FileNotFoundError` at step 5

Older installers could not find the system `runuser` command when running app commands with the private tool PATH, and could leave the temporary `fieldops_migration` login behind. After updating the source checkout:

```bash
sudo -u postgres psql -X -p 5432 -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE fieldops_migration NOLOGIN PASSWORD NULL;" -c "DROP ROLE fieldops_migration;"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
sudo mkdir -m 700 "/etc/field-ops/failed-continuation-$STAMP" &&
sudo mv /etc/field-ops/rest.env /etc/field-ops-console.env "/etc/field-ops/failed-continuation-$STAMP/"
sudo python3 deploy/install-ubuntu.py --resume-after-auth
```
