# Interactive native app upgrade

Use this script for a working installation created by the native Ubuntu installer. It upgrades **the application and pending application migrations**, not PostgreSQL, Node, Bun, Auth, PostgREST, Nginx or operating-system packages. Review and upgrade those separately; network helpers continue their existing release-update process.

## Run from new, reviewed source

Download a reviewed GitHub revision into a **separate checkout**, not `/opt/field-ops-console`. Use existing repository access; do not put access tokens in clone URLs. Review changes and migration files, including compatibility with installed runtime/backend versions.

From that new checkout:

```bash
python3 deploy/upgrade-ubuntu.py --dry-run
sudo python3 deploy/upgrade-ubuntu.py
```

The script asks for the new source folder, displays the website and pending-migration count, and requires typing `UPGRADE`. Dry run validates source files only; it does not read private settings or prove the target VM is ready.

Before confirming, arrange a maintenance window, finish active router/helper jobs, and stop any independent jobs that write directly to the database. The website, Auth and REST services pause during backup/migration/switch; visitors may see temporary unavailability. An in-progress router job cannot be undone by a database backup.

## Upgrade sequence

1. Require Ubuntu, a completed native installation, healthy current services, private root-owned settings and sufficient staging disk space. Use saved private runtime locations and database ports (legacy defaults for earlier installations). Only one upgrade runs at a time; unrelated websites and database clusters are not stopped.
2. Reject missing or modified applied migrations using the database's private checksum journal.
3. Copy clean new source to a private staging folder under `/opt`, install locked dependencies and build using a separate deployment account while the current app stays online. Build commands receive public configuration only, not server secrets.
4. Stop website/Auth/REST writes; save a PostgreSQL custom-format backup, database roles and private application/settings/service configuration under `/var/backups/field-ops/<timestamp>`. Verify the database archive is readable. This is **not** a full restore rehearsal.
5. Freeze the staging folder to root ownership, revalidate migration inputs and apply reviewed SQL transactionally through the local PostgreSQL administrator's peer connection. Preserve the existing checksum journal; no superuser password is created or passed to application package scripts.
6. Keep the previous app at `/opt/field-ops-previous-<timestamp>`, switch to the staged build, restart services, and check local/public website availability and the existing standalone readiness checks.

Existing users, records, API credentials, signing/encryption keys, SMTP settings, service units and HTTPS configuration are preserved. The script never recreates accounts or replaces `/etc/field-ops-console.env`. It does not rotate keys, change domains or apply Auth's own schema migrations.

Backups contain password hashes, encrypted integration credentials and **decryption/signing secrets**: they are root-only but not automatically encrypted at rest. Use encrypted disks and encrypted off-VM backup storage. The script neither uploads backups nor deletes old backups/builds; plan capacity and retention. Keep TLS certificate backups separately.

## Failure and recovery

- **Before migrations:** if preparation fails, the existing app stays online. If a backup or switch fails before any migration starts, the script restarts the previous app and leaves the backup/state for inspection.
- **After a migration starts:** commit status can be uncertain if a connection or cleanup fails. The script leaves website/Auth/REST stopped and preserves both app folders and backups. It does **not** automatically run old code against a possibly changed database or restore a backup that could erase data.
- **Interrupted process or power loss:** automatic recovery is not guaranteed. Inspect the root-only `upgrade.json`, service status and app folders. Do not blindly rerun the fresh installer or upgrade.

Inspect privately:

```bash
sudo systemctl status field-ops-console field-ops-auth field-ops-rest --no-pager
sudo journalctl -u field-ops-console -u field-ops-auth -u field-ops-rest -n 80 --no-pager
sudo nginx -t
```

Do not share raw logs or backup/settings contents. For manual recovery after migrations, have the database administrator determine whether the migration transaction committed using the private migration journal. If compatible, repair the new app and resume it. Otherwise, rehearse restoring `database.dump` **into an isolated new database first**, with the matching original keys/configuration and previous app. Reconcile any external SIM/router actions and records created after backup before a cutover. Never restore directly over the live database without an approved recovery plan.

When the correct app/database pairing is restored and checked, restart:

```bash
sudo systemctl start field-ops-auth field-ops-rest field-ops-console
```

## Acceptance after every upgrade

Sign in as an administrator, confirm existing records read back, test a non-admin's restrictions and perform approved Console Connect/helper checks. Complete [the standalone acceptance checklist](README.md#6-required-acceptance-checks). The automated readiness checks do not prove SMTP delivery, Okta, browser sign-in or live SIM/router operations.

**Verification limit:** source validation, environment parsing, checksum guards, credential suppression, peer-authenticated migration commands and shutdown handling are unit-tested. Full staging/build/backup/migration/recovery execution on a real Ubuntu VM remains unverified.