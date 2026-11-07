#!/usr/bin/env python3
"""Interactive app-only upgrade for the native Ubuntu installation.

Run from a reviewed NEW repository checkout. --dry-run validates without writes.
Runtime/backend packages and router helper installations are not upgraded here.
"""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error

APP = Path('/opt/field-ops-console')
CONFIG = Path('/etc/field-ops')
ENV = Path('/etc/field-ops-console.env')
BACKUPS = Path('/var/backups/field-ops')
SERVICES = ('field-ops-console', 'field-ops-auth', 'field-ops-rest')
EXCLUDED = {'.git', '.env', 'node_modules', '.output', 'dist', '.tanstack', '.workspace', '__pycache__'}


def run(args, *, data=None, cwd=None, user=None, env=None):
    if user:
        args = ['runuser', '-u', user, '--', *args]
    result = subprocess.run(args, input=data, cwd=cwd, env=env, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('A command failed; output suppressed to protect credentials. Inspect services privately.')
    return result.stdout


def read_environment(path):
    """Read the double-quoted systemd format produced by the native installer.

    Never evaluate shell commands, variable expansion or Python literals.
    """
    values = {}
    for line in Path(path).read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)="((?:[^"\\]|\\["\\])*)"', line)
        if not match or match[1] in values:
            raise RuntimeError('Unsupported or duplicate environment assignment; use the native installer format.')
        values[match[1]] = re.sub(r'\\(["\\])', r'\1', match[2])
    required = {'FIELD_OPS_STANDALONE', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DB_SECRET_KEY'}
    if not required.issubset(values) or values['FIELD_OPS_STANDALONE'] != '1' or values['SUPABASE_URL'] != 'http://127.0.0.1:8000':
        raise RuntimeError('This upgrade requires the existing native local backend configuration.')
    return values


def source_manifest(source):
    source = Path(source).resolve()
    for name in ('package.json', 'bun.lock', 'deploy/build.mjs', 'deploy/migrate.mjs', 'deploy/check.mjs', 'deploy/start.mjs', 'drizzle/migrations/meta/_journal.json'):
        if not (source / name).is_file():
            raise RuntimeError('Select a complete reviewed source checkout, not an app build.')
    manifest = json.loads((source / 'drizzle/migrations/meta/_journal.json').read_text())
    tags = [entry['tag'] for entry in manifest['entries']]
    if len(tags) != len(set(tags)):
        raise RuntimeError('Duplicate migration journal entries.')
    hashes = {}
    for tag in tags:
        if not re.fullmatch(r'\d{4}_[a-z_]+', tag):
            raise RuntimeError('Invalid migration tag.')
        hashes[tag] = hashlib.sha256((source / f'drizzle/migrations/{tag}.sql').read_bytes()).hexdigest()
    return hashes


def validate_history(applied, proposed):
    for tag, checksum in applied.items():
        if proposed.get(tag) != checksum:
            raise RuntimeError('An applied migration is missing or changed. Upgrade refused; never rewrite migration history.')
    return [tag for tag in proposed if tag not in applied]


def ignore_source(directory, names):
    ignored = []
    for name in names:
        path = Path(directory) / name
        if name in EXCLUDED or name.startswith('.env.') or (name.startswith('.') and name not in ('.gitignore', '.prettierignore', '.prettierrc')):
            ignored.append(name)
        elif path.is_symlink():
            # Source symlinks could copy external secrets or executable content.
            raise RuntimeError('Source contains a symbolic link; use a clean exported checkout.')
    return ignored


def preflight(source):
    if os.geteuid() != 0:
        raise RuntimeError('Run with sudo on the target VM.')
    release = Path('/etc/os-release').read_text()
    if not re.search(r'^ID=ubuntu$', release, re.M) or not re.search(r'^VERSION_ID="24\.04"$', release, re.M):
        raise RuntimeError('Ubuntu 24.04 LTS is required.')
    if not APP.is_dir() or APP.is_symlink() or not CONFIG.is_dir() or CONFIG.is_symlink() or ENV.is_symlink():
        raise RuntimeError('A native installation at the standard paths is required; symlinks are refused.')
    state = json.loads((CONFIG / 'installation.json').read_text())
    if state.get('status') != 'installed':
        raise RuntimeError('The initial installation is incomplete; upgrade refused.')
    if source == APP or APP in source.parents or source in APP.parents:
        raise RuntimeError('Use a separate new source checkout, outside the installed application.')
    for name in SERVICES:
        run(['systemctl', 'is-active', '--quiet', name])
    for path in (CONFIG, ENV):
        if path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
            raise RuntimeError('Existing secret settings must be root-owned and private.')
    if shutil.disk_usage('/opt').free < 12 * 1024**3:
        raise RuntimeError('At least 12 GB free in /opt is required for a staged build.')
    run(['pg_isready', '-d', 'fieldops'], user='postgres', cwd='/tmp')
    applied = json.loads(run(['psql', '-d', 'fieldops', '-tAc', "SELECT coalesce(json_object_agg(tag,checksum),'{}'::json) FROM field_ops_deploy.migrations;"], user='postgres', cwd='/tmp'))
    return state, read_environment(ENV), applied


def dump_database(destination):
    # File opened by root; peer-authenticated postgres emits backup over stdout.
    with open(destination / 'database.dump', 'xb') as handle:
        os.chmod(handle.name, 0o600)
        result = subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-Fc', '-d', 'fieldops'], cwd='/tmp', stdout=handle, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Database backup failed; no migrations were run.')
    with open(destination / 'roles.sql', 'xb') as handle:
        os.chmod(handle.name, 0o600)
        result = subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dumpall', '--globals-only'], cwd='/tmp', stdout=handle, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Database role backup failed; no migrations were run.')
    # Verify archive readability; a full restoration rehearsal remains separate.
    run(['pg_restore', '--list', str(destination / 'database.dump')])
    shutil.copytree(CONFIG, destination / 'settings')
    shutil.copy2(ENV, destination / 'app.env')
    infra = destination / 'service-config'
    infra.mkdir(mode=0o700)
    for name in SERVICES:
        shutil.copy2(Path('/etc/systemd/system') / (name + '.service'), infra)
    shutil.copy2('/etc/nginx/sites-available/field-ops-native', infra / 'nginx-site.conf')
    shutil.copy2('/etc/nginx/conf.d/field-ops-keys.conf', infra / 'nginx-keys.conf')
    write_status(destination, 'backup_complete')


def write_status(destination, status, **extra):
    path = destination / 'upgrade.json'
    record = json.loads(path.read_text()) if path.exists() else {}
    record.update(status=status, **extra)
    path.write_text(json.dumps(record, indent=2))
    path.chmod(0o600)


def migrate(staged, env):
    role = 'fieldops_upgrade_' + secrets.token_hex(8)
    password = secrets.token_hex(32)
    run(['psql', '-v', 'ON_ERROR_STOP=1', '-q'], user='postgres', cwd='/tmp', data=f"CREATE ROLE {role} LOGIN SUPERUSER PASSWORD '{password}';")
    try:
        run(['/usr/local/bin/bun', 'run', 'db:migrate:standalone'], cwd=staged, user='fieldops-web', env={**os.environ, **env, 'STANDALONE_DATABASE_URL': f'postgresql://{role}:{password}@127.0.0.1:5432/fieldops?sslmode=disable'})
        run(['psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', 'fieldops'], user='postgres', cwd='/tmp', data=f'REASSIGN OWNED BY {role} TO fieldops_owner; DROP OWNED BY {role};')
    finally:
        run(['psql', '-v', 'ON_ERROR_STOP=1', '-q'], user='postgres', cwd='/tmp', data=f'ALTER ROLE {role} NOLOGIN PASSWORD NULL;')
    run(['psql', '-v', 'ON_ERROR_STOP=1', '-q'], user='postgres', cwd='/tmp', data=f'DROP ROLE {role};')


def wait_site(url):
    for _ in range(30):
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(2)
    raise RuntimeError('The upgraded website did not become healthy.')


def upgrade(source, env, state, pending):
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(3)
    staged = Path('/opt') / ('field-ops-stage-' + stamp)
    previous = Path('/opt') / ('field-ops-previous-' + stamp)
    destination = BACKUPS / stamp
    stopped = False
    migration_started = False
    switched = False
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    if BACKUPS.is_symlink() or BACKUPS.stat().st_uid != 0 or BACKUPS.stat().st_mode & 0o077:
        raise RuntimeError('Backup directory must be root-owned, private and not a symlink.')
    destination.mkdir(mode=0o700)
    write_status(destination, 'preparing', previous_app=str(previous), pending_migrations=pending)
    try:
        print('1/5 Preparing the new app while the current website stays online…')
        shutil.copytree(source, staged, ignore=ignore_source)
        run(['chown', '-R', 'fieldops-web:fieldops-web', str(staged)])
        build_env = {**os.environ, **env, 'HOME': str(staged)}
        run(['/usr/local/bin/bun', 'install', '--frozen-lockfile'], cwd=staged, user='fieldops-web', env=build_env)
        run(['/usr/local/bin/bun', 'run', 'build:standalone'], cwd=staged, user='fieldops-web', env=build_env)
        if not (staged / '.output/server/index.mjs').is_file():
            raise RuntimeError('New standalone server output is missing.')
        print('2/5 Stopping writes and creating private database/settings backups…')
        # Native API listeners are down during the snapshot, including Auth and
        # helper REST writes. Router jobs already running on helpers are not undone.
        stopped = True
        run(['systemctl', 'stop', *SERVICES])
        dump_database(destination)
        print('3/5 Applying checked-in application migrations…')
        if pending:
            migration_started = True
            write_status(destination, 'migration_started')
            migrate(staged, env)
            write_status(destination, 'migration_committed')
        print('4/5 Switching to the prepared app…')
        APP.rename(previous)
        try:
            staged.rename(APP)
        except BaseException:
            previous.rename(APP)
            raise
        switched = True
        write_status(destination, 'app_switched')
        run(['systemctl', 'start', 'field-ops-auth', 'field-ops-rest', 'field-ops-console'])
        print('5/5 Checking the upgraded app…')
        wait_site('http://127.0.0.1:3000/')
        wait_site('https://' + state['website'] + '/')
        run(['/usr/local/bin/bun', 'run', 'check:standalone'], cwd=APP, user='fieldops-web', env={**os.environ, **env, 'HOME': str(APP)})
        write_status(destination, 'complete')
        print('Upgrade complete. Verify sign-in, saved records and your operational integrations.')
        print(f'Private backup: {destination}\nPrevious app: {previous}')
        print('Backups and previous apps are not deleted automatically. Store encrypted off-VM backups and test restore.')
    except BaseException:
        if stopped:
            run(['systemctl', 'stop', *SERVICES])
            if not migration_started:
                if switched:
                    failed = Path('/opt') / ('field-ops-failed-' + stamp)
                    APP.rename(failed)
                    previous.rename(APP)
                run(['systemctl', 'start', 'field-ops-auth', 'field-ops-rest', 'field-ops-console'])
                write_status(destination, 'failed_previous_app_restarted')
            else:
                # A migration may have committed even when cleanup/checks failed.
                # Never run old code against a possibly incompatible schema or
                # silently restore a DB backup that would erase later writes.
                write_status(destination, 'failed_manual_recovery_required')
                print('Services remain stopped: database changes may have committed. Follow UPGRADE.md recovery instructions.', file=sys.stderr)
        else:
            write_status(destination, 'failed_before_downtime')
        print(f'Preserved upgrade state: {destination}', file=sys.stderr)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    print('Frontier Field Ops Console — interactive app upgrade')
    print('Use a reviewed NEW source checkout. Runtime packages, backend services and secrets are preserved.')
    raw = input('New source checkout path [' + str(Path(__file__).resolve().parent.parent) + ']: ').strip()
    source = Path(raw or Path(__file__).resolve().parent.parent).resolve()
    proposed = source_manifest(source)
    if args.dry_run:
        print(f'Dry run: {len(proposed)} migration files validated. No settings read, services stopped, backups created or app changed.')
        return
    # Hold one lock across validation, build, backup, migration and switch.
    with open('/run/lock/field-ops-upgrade.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another upgrade is already running.')
        state, env, applied = preflight(source)
        pending = validate_history(applied, proposed)
        print(f'Website: https://{state["website"]}\nNew migration files: {len(pending)}')
        print('The website and API will pause for backup, migrations and final checks.')
        print('Confirm no other tools write directly to this database and no helper/router jobs are in progress.')
        if input('Type UPGRADE to proceed: ').strip() != 'UPGRADE':
            print('Cancelled. Nothing changed.')
            return
        upgrade(source, env, state, pending)


if __name__ == '__main__':
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print('Upgrade interrupted. Preserve backups and consult recovery instructions.', file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Upgrade stopped. No credentials printed; preserve partial state and inspect services privately.', file=sys.stderr)
        sys.exit(1)