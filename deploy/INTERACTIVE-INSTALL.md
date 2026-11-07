# Interactive Ubuntu installation

The installer runs the website, PostgreSQL, Auth, PostgREST and Nginx directly on Ubuntu as native services. It obtains HTTPS certificates, generates private keys on the VM, applies the checked-in application migrations and creates the first administrator through the sign-in service. It does not copy hosted users or data.

## Before starting

- Use a **fresh, dedicated Ubuntu 24.04 LTS x86_64 VM** with systemd, approximately 4 vCPUs, 8 GB RAM and 40 GB disk (at least 12 GB free). This is not a tested capacity guarantee.
- Point **two distinct DNS hostnames** at its static public IP: website and backend API.
- Allow inbound 80/443 in GCP; restrict SSH to your IP or IAP. Do not open database or internal service ports.
- Have working SMTP hostname, submission port, username, password and sender address. Email confirmation and password recovery require SMTP. SMTP setup does not enable invitation notification emails in the app.
- Clone a reviewed revision of your repository using your existing GitHub access. Do not embed access tokens in repository URLs or copy hosted `.env` files.
- Back up anything already on the VM. The installer refuses existing PostgreSQL clusters, app destinations, service accounts or conflicting ports rather than overwriting them. It is not an upgrade or restore tool.

## Run from your repository checkout

Preview the questions with no changes:

```bash
python3 deploy/install-ubuntu.py --dry-run
```

Install on the target VM:

```bash
sudo python3 deploy/install-ubuntu.py
```

Answer the prompts for website/API hostnames, administrator email and strong password, SMTP settings and whether you have independently verified that first administrator's email. Password prompts are hidden. No passwords or private keys are printed or passed in command arguments. Confirm the final summary to begin. Downloads/builds can take several minutes; a failed step stops installation.

The installer keeps public signup disabled: admins invite subsequent users. Email auto-confirmation remains off. If you decline the explicit first-admin verification question, the installer sends a confirmation email; verify delivery before use. It never sends the administrator password by email.

## What is installed

- Native Ubuntu PostgreSQL with a private `fieldops` database and separate Auth/REST roles.
- Auth `v2.196.0`, compiled from a pinned upstream commit using verified Go `1.26.5`; PostgREST `v16.5`.
- Verified Node `22.22.0` and Bun `1.3.3`; the app's locked dependencies and standalone Node build.
- Separate `field-ops-auth`, `field-ops-rest`, and `field-ops-console` systemd services, with localhost-only listeners.
- Nginx website/API configuration, restricted API key routing, browser-origin allowance and trusted HTTPS certificates with renewal timer.
- Private settings in `/etc/field-ops/` and `/etc/field-ops-console.env`. Keys are generated locally; the website receives only the anonymous public key. Signed API keys expire after ten years and must be rotated before expiry (rotation requires rebuilding the website).

Upstream GitHub binary downloads require a published SHA-256 digest; the installer stops if one is unavailable or mismatched. Node's checksum list is fetched from its HTTPS release origin; Go uses a pinned checksum. The Auth source commit is pinned and Go dependencies are verified. Review pinned versions before production use; changing versions requires another compatibility review.

## After installation

1. Open your HTTPS website and sign in as the first administrator. Confirm the email first if requested.
2. Re-enter and test Console Connect credentials in Admin Settings. Configure the independent Okta sign-in provider separately; saved app settings alone do not enable it.
3. Enroll the Network Helper through Admin Settings on a machine with access to your routers. The installer does not assume the GCP VM has company-network routes or silently deploy a helper to the wrong network.
4. Complete [the acceptance checklist](README.md#6-required-acceptance-checks): password login/change/recovery, member restrictions, saved records, helper ping/screenshots, and approved live SIM/router operations.
5. Configure encrypted backups and test restore, reboot recovery and certificate renewal. Keep database backups and encryption/signing secrets together securely.

## If installation stops

No automatic rollback deletes database records or keys. Preserve partial state and inspect the services privately:

```bash
sudo systemctl status field-ops-auth field-ops-rest field-ops-console --no-pager
sudo journalctl -u field-ops-auth -u field-ops-rest -u field-ops-console -n 80 --no-pager
sudo nginx -t
```

Do not share raw logs or secret files. Do not delete `/etc/field-ops` or the database to force a rerun. An unsuccessful fresh install should be diagnosed or restarted on a new VM after securing any needed records. Application updates use the reviewed migration/build procedure in [GCP-UBUNTU.md](GCP-UBUNTU.md#updates-and-troubleshooting), not this fresh-install script; apply future migrations with an authorized local database administrator and do not persist superuser credentials in the website environment.

**Verification status:** safe prompt, validation, secret-handling and syntax checks are included in `test_install_ubuntu.py`. A complete fresh Ubuntu VM installation, SMTP delivery, production build, Okta and real integrations have not been exercised here. This script is a deployment starting point, not a production-readiness certification.