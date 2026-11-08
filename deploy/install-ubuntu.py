#!/usr/bin/env python3
"""Interactive, native Ubuntu installer. Install beside existing Nginx websites or on a new VM.

No secrets are passed in command arguments or printed. --dry-run asks the same
questions but makes no system changes. This is not an upgrade/migration tool.
"""
import argparse
import fcntl
import base64
import getpass
import hashlib
import hmac
import io
import json
import os
import pwd
import grp
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import urllib.error
import zipfile
from urllib.parse import urlsplit

APP = Path('/opt/field-ops-console')
BACKEND = Path('/opt/field-ops-backend')
CONFIG = Path('/etc/field-ops')
STATE = CONFIG / 'installation.json'
NODE_VERSION = '22.22.0'
AUTH_VERSION = 'v2.196.0'
REST_VERSION = 'v16.5'
BUN_VERSION = 'bun-v1.3.3'
AUTH_COMMIT = '0204331ca41a5b49f076b6fa3dc6c0d20b996590'
GO_VERSION = '1.26.5'
GO_CHECKSUM = '5c2c3b16caefa1d968a94c1daca04a7ca301a496d9b086e17ad77bb81393f053'
PORTS = {'web': 3000, 'gateway': 8000, 'auth': 9999, 'rest': 3001, 'database': 5432}
RUNTIME_PATH = str(BACKEND / 'node/bin') + ':' + str(BACKEND / 'bin') + ':/usr/bin:/bin'
SERVICE_USERS = ('fieldops-web', 'fieldops-auth', 'fieldops-rest')
APPROVED_ACCOUNTS = {}
INSTALL_PHASE = 'initial checks'


def diagnose():
    """Read-only, credential-free report for a stopped installation."""
    print('Read-only installer diagnostics (no settings or secret contents shown)')
    print('Python version: ' + sys.version.split()[0])
    print('Safe archive extraction supported: ' + str(hasattr(tarfile, 'data_filter')))
    for path in (CONFIG, STATE, APP, BACKEND, BACKEND / 'node', BACKEND / 'bin/bun', BACKEND / 'postgrest', BACKEND / 'gotrue'):
        kind = 'symlink' if path.is_symlink() else 'directory' if path.is_dir() else 'file' if path.is_file() else 'absent'
        print(str(path) + ': ' + kind)
    print('No files changed. Preserve partial state; do not rerun installation yet.')


def failure_summary(error):
    # Never stringify arbitrary exceptions: messages may contain secrets, URLs
    # or copied-file contents. Class and our own source line identify the fault.
    line = None
    trace = error.__traceback__
    while trace:
        if trace.tb_frame.f_code.co_filename == __file__:
            line = trace.tb_lineno
        trace = trace.tb_next
    return f'Installation stopped during {INSTALL_PHASE}: {type(error).__name__}, installer line {line or "unknown"}. No secret values printed. Preserve partial state; do not rerun over it.'



def domain(value):
    value = value.strip().lower()
    if len(value) > 253 or not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?', value):
        raise ValueError('Enter a DNS hostname only, without a scheme, port or path.')
    return value


def email(value):
    value = value.strip()
    if len(value) > 254 or not re.fullmatch(r'[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+', value):
        raise ValueError('Enter a valid email address.')
    return value


def strong_password(value):
    return len(value) >= 12 and len(value) <= 128 and all((re.search(r'[a-z]', value), re.search(r'[A-Z]', value), re.search(r'[0-9]', value), re.search(r'[^a-zA-Z0-9\s]', value))) and not any(c in value for c in '\r\n\x00')


def env_value(value):
    if any(c in value for c in '\r\n\x00'):
        raise ValueError('Multiline settings are not supported.')
    # systemd has no shell expansion: escape only backslash and double quote.
    return '"' + ''.join('\\' + c if c in '\\"' else c for c in value) + '"'


def jwt(secret, role, now=None):
    now = int(time.time()) if now is None else now
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=').decode()
    header = encode(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    body = encode(json.dumps({'role': role, 'aud': 'authenticated', 'iss': 'supabase', 'iat': now, 'exp': now + 10 * 365 * 86400}, separators=(',', ':')).encode())
    message = header + '.' + body
    return message + '.' + encode(hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest())


def ask(label, default='', validate=None, hidden=False):
    while True:
        prompt = label + (f' [{default}]' if default else '') + ': '
        raw = getpass.getpass(prompt) if hidden else input(prompt)
        value = (raw if hidden else raw.strip()) or default
        try:
            if not value:
                raise ValueError('This value is required.')
            if any(c in value for c in '\r\n\x00'):
                raise ValueError('Use a single-line value.')
            return validate(value) if validate else value
        except ValueError as error:
            print(error)


def confirm(label, default=False):
    answer = input(label + (' [Y/n]: ' if default else ' [y/N]: ')).strip().lower()
    return default if not answer else answer in ('y', 'yes')


def settings():
    print('Frontier Field Ops Console — native Ubuntu installer')
    print('Install alongside existing Nginx websites. Existing Field Ops installations are never overwritten.')
    print('Point two DNS names at this VM and allow inbound 80/443 before continuing.')
    website = ask('Website hostname', validate=domain)
    api = ask('Backend API hostname', validate=domain)
    if website == api:
        raise ValueError('The website and API need different hostnames.')
    admin = ask('First administrator email', validate=email)
    password = ask('Administrator password (12+ characters, upper/lowercase, number, symbol)', hidden=True,
                   validate=lambda v: v if strong_password(v) else (_ for _ in ()).throw(ValueError('Password is not strong enough.')))
    if ask('Confirm administrator password', hidden=True) != password:
        raise ValueError('Passwords do not match; nothing has been installed.')
    smtp_host = ask('SMTP hostname', validate=domain)
    smtp_port = ask('SMTP submission port', '587', validate=lambda v: v if v.isdigit() and 1 <= int(v) <= 65535 else (_ for _ in ()).throw(ValueError('Invalid port.')))
    smtp_user = ask('SMTP username')
    smtp_password = ask('SMTP password', hidden=True)
    sender = ask('SMTP sender email', admin, email)
    print('Email confirmation remains required unless you explicitly verify this first admin here.')
    verified = confirm('Mark ONLY this installer-created administrator email as already verified?')
    print('Console Connect, Okta and router settings are configured in Admin Settings after installation.')
    return dict(website=website, api=api, admin=admin, password=password, smtp_host=smtp_host,
                smtp_port=smtp_port, smtp_user=smtp_user, smtp_password=smtp_password, sender=sender, verified=verified)


def runuser_path():
    # Service commands get a private PATH without /usr/sbin, so never resolve
    # runuser through the child environment.
    for candidate in ('/usr/sbin/runuser', '/sbin/runuser'):
        path = Path(candidate)
        if path.is_file() and path.stat().st_uid == 0 and not path.stat().st_mode & 0o022:
            return candidate
    raise RuntimeError('The system runuser command was not found in /usr/sbin or /sbin.')


def run(args, *, data=None, cwd=None, user=None, env=None, quiet=False):
    if args[0] in ('psql', 'pg_isready') and user == 'postgres':
        args = [args[0], '-p', str(PORTS['database']), *args[1:]]
    if user:
        args = [runuser_path(), '-u', user, '--', *args]
    result = subprocess.run(args, input=data, text=True, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Upstream output can contain passwords or DB URLs. Never echo it.
        raise RuntimeError(f'A command failed ({Path(args[0]).name}). Inspect the service privately; upstream output was suppressed.')
    if not quiet and result.stdout and args[0] in ('apt-get',):
        print('System packages installed.')
    return result.stdout


def write(path, text, mode=0o600):
    path = Path(path)
    if path.is_symlink():
        raise RuntimeError('Refusing a symbolic-link configuration destination.')
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(text)


def environment(path, values):
    write(path, ''.join(key + '=' + env_value(str(value)) + '\n' for key, value in values.items()))


def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'field-ops-native-installer'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def release_asset(repo, tag, name):
    release = json.loads(download(f'https://api.github.com/repos/{repo}/releases/tags/{tag}'))
    asset = next((a for a in release['assets'] if a['name'] == name), None)
    if not asset or not (asset.get('digest') or '').startswith('sha256:'):
        raise RuntimeError(f'No upstream SHA-256 digest for {repo} {tag} {name}; refusing an unverified binary.')
    content = download(asset['browser_download_url'])
    if hashlib.sha256(content).hexdigest() != asset['digest'].split(':', 1)[1]:
        raise RuntimeError('Upstream download checksum mismatch.')
    return content


def install_binary(path, content):
    write(path, '', 0o755)
    Path(path).write_bytes(content)
    os.chmod(path, 0o755)


def service_account(user):
    """Accept only dormant, locked, dedicated identities; never modify them."""
    try:
        account = pwd.getpwnam(user)
    except KeyError:
        return None
    group = grp.getgrgid(account.pw_gid)
    allowed_homes = ('/nonexistent', str(APP)) if user == 'fieldops-web' else ('/nonexistent',)
    shadow = run(['getent', 'shadow', user], quiet=True).strip().split(':')
    locked = len(shadow) >= 2 and shadow[1].startswith(('!', '*'))
    if (account.pw_uid == 0 or account.pw_gid == 0 or account.pw_shell not in ('/usr/sbin/nologin', '/sbin/nologin', '/bin/false')
            or account.pw_dir not in allowed_homes or group.gr_name != user or not locked
            or any(member != user for member in group.gr_mem)
            or any(other.pw_gid == account.pw_gid and other.pw_name != user for other in pwd.getpwall())
            or any(user in other.gr_mem and other.gr_gid != account.pw_gid for other in grp.getgrall())):
        raise RuntimeError(f'Existing account {user} is not a locked, dedicated Field Ops service account. It was not changed; review it before installing.')
    processes = run(['ps', '-eo', 'uid='], quiet=True)
    if any(uid.strip() == str(account.pw_uid) for uid in processes.splitlines()):
        raise RuntimeError(f'Existing account {user} has running processes. It was not changed; review which service uses it.')
    return (account.pw_uid, account.pw_gid, account.pw_dir, account.pw_shell)


def check_service_accounts():
    APPROVED_ACCOUNTS.clear()
    existing = {}
    for user in SERVICE_USERS:
        identity = service_account(user)
        if identity is not None:
            existing[user] = identity
    if existing:
        print('Dormant, locked Field Ops service accounts found: ' + ', '.join(existing))
        if not confirm('Reuse these accounts without changing their password, home, groups or permissions?'):
            raise RuntimeError('Account reuse declined. No system changes made; no accounts were deleted.')
        APPROVED_ACCOUNTS.update(existing)


def create_service_accounts():
    for user in SERVICE_USERS:
        identity = service_account(user)
        if identity is not None:
            if APPROVED_ACCOUNTS.get(user) != identity:
                raise RuntimeError(f'Account {user} changed or appeared after preflight; installation stopped without modifying it.')
            continue
        if user in APPROVED_ACCOUNTS:
            raise RuntimeError(f'Approved account {user} disappeared after preflight; installation stopped.')
        run(['useradd', '--system', '--user-group', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', user])


def preflight():
    if os.geteuid() != 0:
        raise RuntimeError('Run this installer with sudo on your target VM.')
    release = dict(line.strip().split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    if release.get('ID', '').strip('"') != 'ubuntu':
        raise RuntimeError('This installer supports Ubuntu only.')
    if os.uname().machine != 'x86_64':
        raise RuntimeError('This initial installer supports x86_64 VMs only.')
    if not Path('/run/systemd/system').exists():
        raise RuntimeError('A running systemd installation is required.')
    if not hasattr(tarfile, 'data_filter'):
        raise RuntimeError('This Python lacks safe archive extraction support. Install an updated Python 3 with tarfile.data_filter before running the installer; no system changes made.')
    for path in (APP, BACKEND, CONFIG, Path('/etc/field-ops-console.env'), Path('/etc/nginx/sites-available/field-ops-native'), Path('/etc/nginx/sites-enabled/field-ops-native'), Path('/etc/nginx/conf.d/field-ops-keys.conf'), Path('/etc/letsencrypt/renewal-hooks/deploy/field-ops-reload'), *(Path('/etc/systemd/system') / f'{name}.service' for name in ('field-ops-console', 'field-ops-auth', 'field-ops-rest'))):
        if path.exists() or path.is_symlink():
            raise RuntimeError(f'Existing destination detected: {path}. This is a fresh-install script, not an upgrade tool.')
    if shutil.disk_usage('/opt').free < 12 * 1024**3:
        raise RuntimeError('At least 12 GB free disk space is needed for source and build tools.')
    check_existing_postgres()
    if any(p.exists() or p.is_symlink() for p in (Path('/etc/letsencrypt/live/field-ops-native'), Path('/etc/letsencrypt/archive/field-ops-native'), Path('/etc/letsencrypt/renewal/field-ops-native.conf'))):
        raise RuntimeError('The Field Ops certificate destination already exists.')
    source = Path(__file__).resolve().parent.parent
    for path in ('package.json', 'bun.lock', 'deploy/build.mjs', 'deploy/migrate.mjs', 'drizzle/migrations/meta/_journal.json'):
        if not (source / path).is_file():
            raise RuntimeError('Run the installer from a complete reviewed repository checkout.')
    check_service_accounts()
    return source


def occupied_ports(listeners):
    ports = set()
    for line in listeners.splitlines():
        fields = line.split()
        if len(fields) >= 4:
            match = re.search(r':(\d+)$', fields[3])
            if match:
                ports.add(int(match[1]))
    return ports


def choose_ports(listeners=None):
    used = occupied_ports(run(['ss', '-H', '-ltn'], quiet=True) if listeners is None else listeners)
    used.add(5432)
    chosen = {}
    print('Choose private service ports; existing listeners are excluded automatically.')
    for name, preferred in PORTS.items():
        if name == 'database':
            chosen[name] = 5432
            used.add(5432)
            continue
        candidate = preferred
        while candidate in used or candidate in (80, 443):
            candidate += 1
            if candidate > 65535:
                raise RuntimeError('No free default port was found.')
        def validate(value):
            if not value.isdigit() or not 1024 <= int(value) <= 65535 or int(value) in used or int(value) in (80, 443):
                raise ValueError('Choose an unused port between 1024 and 65535.')
            return int(value)
        chosen[name] = ask(name.capitalize() + ' localhost port', str(candidate), validate)
        used.add(chosen[name])
    return chosen


def check_shared_host(values):
    listeners = run(['ss', '-H', '-ltnp'], quiet=True)
    for line in listeners.splitlines():
        ports = occupied_ports(line)
        if ports.intersection(value for name, value in PORTS.items() if name != 'database'):
            raise RuntimeError('A selected private port is now occupied; no services were installed.')
        if ports.intersection({80, 443}) and not re.search(r'\("nginx"[,)]', line):
            raise RuntimeError('Another web server owns port 80/443. Configure Nginx sharing first; the installer will not stop it.')
    if shutil.which('nginx'):
        # nginx -T is captured privately: it may contain unrelated credentials.
        config = run(['nginx', '-T'], quiet=True)
        names = []
        for match in re.finditer(r'(?m)^\s*server_name\s+([^;]+);', re.sub(r'#[^\n]*', '', config)):
            names.extend(match[1].split())
        for host in (values['website'], values['api']):
            for name in names:
                if name == host or (name.startswith('*.') and host.endswith(name[1:])) or (name.startswith('.') and (host == name[1:] or host.endswith(name))) or name.startswith('~'):
                    raise RuntimeError('An existing Nginx hostname or pattern conflicts with this installation; choose unused hostnames or review that site first.')
    print('Existing websites, runtimes and PostgreSQL settings will not be replaced.')


def check_existing_postgres():
    """Read-only checks on the existing service; never create/start a cluster."""
    if not shutil.which('psql') or not shutil.which('pg_isready'):
        raise RuntimeError('Existing PostgreSQL on port 5432 is required. Install and start PostgreSQL separately; this installer does not create clusters.')
    run(['pg_isready', '-h', '127.0.0.1'], user='postgres', cwd='/tmp', quiet=True)
    result = run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', 'postgres'], user='postgres', cwd='/tmp', quiet=True, data="""
SELECT current_setting('server_version_num');
SELECT 'database_conflict' FROM pg_database WHERE datname = 'fieldops';
SELECT 'role_conflict' FROM pg_roles WHERE rolname IN
('fieldops_owner', 'supabase_auth_admin', 'authenticator', 'anon', 'authenticated', 'service_role', 'fieldops_migration');
""")
    lines = result.strip().splitlines()
    if not lines or not lines[0].isdigit():
        raise RuntimeError('Could not verify existing PostgreSQL on port 5432.')
    if len(lines) != 1:
        raise RuntimeError('The fieldops database or required backend roles already exist on port 5432. Nothing was replaced; preserve partial state or use the upgrade script for a completed installation.')
    return str(int(lines[0]) // 10000)


def prepare_auth_database():
    # Pop creates its migration tracking table without a schema qualifier.
    # Keep that table in auth, not public (where CREATE is deliberately revoked).
    run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-d', 'fieldops'], user='postgres', cwd='/tmp', data='''
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
ALTER ROLE supabase_auth_admin IN DATABASE fieldops SET search_path = auth, public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
GRANT CONNECT ON DATABASE fieldops TO supabase_auth_admin, authenticator;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin, anon, authenticated, service_role;
''')


def unit(name, executable, env_file, user, workdir, after='postgresql.service'):
    write('/etc/systemd/system/' + name + '.service', f'''[Unit]
Description=Frontier {name}
After=network-online.target {after}
Wants=network-online.target
[Service]
User={user}
Group={user}
WorkingDirectory={workdir}
EnvironmentFile={env_file}
Environment=PATH={RUNTIME_PATH}
ExecStart={executable}
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
UMask=0077
[Install]
WantedBy=multi-user.target
''', 0o644)


def wait_url(url):
    for _ in range(60):
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(2)
    raise RuntimeError('A local service did not become healthy; inspect its journal privately.')


def restart_clean():
    """Remove a partial or failed installation so a fresh install can run.

    Moves remaining files into a timestamped backup instead of deleting them,
    drops only the installer-created database and roles, and leaves service
    accounts, other websites, other databases and clusters untouched.
    """
    if os.geteuid() != 0:
        raise RuntimeError('Run clean restart with sudo on the target Ubuntu server.')
    print('Clean restart removes the Field Ops installation so a fresh install can run:')
    for path in (APP, BACKEND, CONFIG, Path('/etc/field-ops-console.env')):
        print('  ' + str(path) + ': ' + ('present' if path.exists() or path.is_symlink() else 'absent'))
    print('  services: field-ops-console, field-ops-auth, field-ops-rest')
    print('  Nginx: field-ops-native site and key map only')
    print('  database: fieldops and installer-created roles on local PostgreSQL')
    print('  certificate: field-ops-native, if issued')
    print('Service accounts are kept for safe reuse; other websites, databases and clusters are untouched.')
    print('Remaining files are moved to a timestamped backup, not deleted.')
    if ask("Type RESTART to remove this installation") != 'RESTART':
        print('Cancelled. No changes made.')
        return
    for name in ('field-ops-console', 'field-ops-auth', 'field-ops-rest'):
        unit_path = Path('/etc/systemd/system') / (name + '.service')
        if unit_path.exists() or unit_path.is_symlink():
            try:
                run(['systemctl', 'disable', '--now', name], quiet=True)
            except Exception:
                print('  Note: service ' + name + ' was not running; continuing.')
            unit_path.unlink()
    if any((Path('/etc/systemd/system') / (name + '.service')).exists() for name in ('field-ops-console', 'field-ops-auth', 'field-ops-rest')):
        raise RuntimeError('Clean restart refused: a service file could not be removed.')
    run(['systemctl', 'daemon-reload'], quiet=True)
    for path in (Path('/etc/nginx/sites-enabled/field-ops-native'), Path('/etc/nginx/sites-available/field-ops-native'),
                 Path('/etc/nginx/conf.d/field-ops-keys.conf'), Path('/etc/letsencrypt/renewal-hooks/deploy/field-ops-reload')):
        if path.is_symlink() or path.exists():
            path.unlink()
    try:
        run(['nginx', '-t'], quiet=True)
        run(['systemctl', 'reload', 'nginx'], quiet=True)
    except Exception:
        print('  Note: Nginx was not reloaded; check it before serving other sites.')
    cert_paths = [Path('/etc/letsencrypt/live/field-ops-native'), Path('/etc/letsencrypt/archive/field-ops-native'), Path('/etc/letsencrypt/renewal/field-ops-native.conf')]
    if any(p.exists() or p.is_symlink() for p in cert_paths):
        try:
            run(['certbot', 'delete', '--cert-name', 'field-ops-native', '--non-interactive'], quiet=True)
        except Exception:
            raise RuntimeError('Clean restart refused: the Field Ops certificate could not be removed; remove it with certbot and retry.')
    if shutil.which('psql'):
        exists = run(['psql', '-X', '-At', '-d', 'postgres', '-c', "SELECT 1 FROM pg_database WHERE datname = 'fieldops'"], user='postgres', cwd='/tmp', quiet=True).strip()
        if exists == '1':
            run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-d', 'postgres'], user='postgres', cwd='/tmp',
                data="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'fieldops' AND pid <> pg_backend_pid();\nDROP DATABASE fieldops;")
        run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-d', 'postgres'], user='postgres', cwd='/tmp',
            data='\n'.join('DROP ROLE IF EXISTS ' + role + ';' for role in ('fieldops_migration', 'fieldops_owner', 'supabase_auth_admin', 'authenticator', 'anon', 'authenticated', 'service_role')))
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    backup = Path('/var/backups/field-ops-clean-' + stamp)
    backup.mkdir(mode=0o700)
    for path in (APP, BACKEND, CONFIG, Path('/etc/field-ops-console.env')):
        if path.is_symlink() or path.exists():
            shutil.move(str(path), str(backup / path.name))
    print('Clean restart complete. Remaining files preserved under ' + str(backup))
    print('You can now run a fresh installation: sudo python3 deploy/install-ubuntu.py')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Prompt and validate only; do not install or write settings')
    parser.add_argument('--diagnose', action='store_true', help='Show read-only Python and installation-path diagnostics; no secrets or changes')
    parser.add_argument('--resume-after-auth', action='store_true', help='Continue only a verified partial installation after Auth tables were created')
    parser.add_argument('--restart-clean', action='store_true', help='Remove a partial or failed installation (kept in a backup) so a fresh install can run')
    args = parser.parse_args()
    if args.diagnose:
        diagnose()
        return
    if args.restart_clean:
        if args.dry_run or args.resume_after_auth:
            raise RuntimeError('Use --restart-clean on its own.')
        restart_clean()
        return
    if args.resume_after_auth:
        if args.dry_run:
            raise RuntimeError('Use --resume-after-auth separately from --dry-run.')
        resume_after_auth()
        return
    source = None if args.dry_run else preflight()
    values = settings()
    selected = choose_ports('' if args.dry_run else None)
    PORTS.update(selected)
    print('Database: existing local PostgreSQL on port 5432; no clusters will be created.')
    if not args.dry_run:
        check_shared_host(values)
    print(f'\nWebsite: https://{values["website"]}\nAPI: https://{values["api"]}')
    print('Services: PostgreSQL, Auth, PostgREST, Nginx, Node website; HTTPS certificates and first admin.')
    print('Downloads use pinned versions; unavailable checksums stop installation, never bypass verification.')
    if args.dry_run:
        print('Dry run complete. No packages, files, accounts, certificates or services changed.')
        return
    if not confirm('Install isolated Field Ops services alongside existing applications now?'):
        print('Cancelled. No system changes made.')
        return
    install(source, values)


def install(source, values):
    global INSTALL_PHASE
    INSTALL_PHASE = 'tool download verification'
    print('1/8 Downloading and verifying native tools…')
    node_name = f'node-v{NODE_VERSION}-linux-x64.tar.xz'
    sums = download(f'https://nodejs.org/dist/v{NODE_VERSION}/SHASUMS256.txt').decode()
    expected = next((line.split()[0] for line in sums.splitlines() if line.split()[-1] == node_name), None)
    node_data = download(f'https://nodejs.org/dist/v{NODE_VERSION}/{node_name}')
    go_data = download(f'https://go.dev/dl/go{GO_VERSION}.linux-amd64.tar.gz')
    if not expected or hashlib.sha256(node_data).hexdigest() != expected or hashlib.sha256(go_data).hexdigest() != GO_CHECKSUM:
        raise RuntimeError('Node or Go checksum mismatch.')
    rest_data = release_asset('PostgREST/postgrest', REST_VERSION, f'postgrest-{REST_VERSION}-linux-static-x86-64.tar.xz')
    bun_data = release_asset('oven-sh/bun', BUN_VERSION, 'bun-linux-x64.zip')
    CONFIG.mkdir(mode=0o700)
    write(STATE, json.dumps({'status': 'installing', 'website': values['website'], 'api': values['api'], 'ports': dict(PORTS), 'runtime_bin': str(BACKEND / 'bin'), 'node_bin': str(BACKEND / 'node/bin'), 'versions': {'node': NODE_VERSION, 'auth': AUTH_VERSION, 'rest': REST_VERSION, 'bun': BUN_VERSION}}))
    INSTALL_PHASE = 'Ubuntu packages'
    print('2/8 Installing Ubuntu packages and service accounts…')
    run(['apt-get', 'update'])
    package_env = {**os.environ, 'DEBIAN_FRONTEND': 'noninteractive', 'NEEDRESTART_MODE': 'l'}
    # PostgreSQL must already be installed. Do not install server packages that
    # could implicitly create another cluster or edit host-wide database settings.
    run(['apt-get', 'install', '-y', '--no-upgrade', 'ca-certificates', 'curl', 'git', 'make', 'xz-utils', 'unzip', 'nginx', 'certbot', 'python3-certbot-nginx'], env=package_env)
    INSTALL_PHASE = 'service account setup'
    print('  Checking and creating service accounts…')
    create_service_accounts()
    INSTALL_PHASE = 'application directories'
    BACKEND.mkdir(mode=0o755)
    APP.mkdir(mode=0o755)
    INSTALL_PHASE = 'source copy'
    print('  Copying reviewed application source…')
    # Exclude repository metadata and hosted credentials at every depth.
    shutil.copytree(source, APP, dirs_exist_ok=True, ignore=shutil.ignore_patterns('.git', '.env', '.env.*', 'node_modules', '.output', 'dist', '.tanstack', '.lovable', '.workspace', '__pycache__'))
    run(['chown', '-R', 'fieldops-web:fieldops-web', str(APP)])
    INSTALL_PHASE = 'native archive extraction'
    print('  Extracting verified native tools…')
    with tempfile.TemporaryDirectory(prefix='field-ops-install-') as temp:
        staging = Path(temp)
        os.chmod(staging, 0o755)
        for content, target in ((node_data, staging / 'node'), (go_data, staging / 'go')):
            target.mkdir()
            with tarfile.open(fileobj=io.BytesIO(content)) as archive:
                archive.extractall(target, filter='data')
        shutil.copytree(staging / 'node' / f'node-v{NODE_VERSION}-linux-x64', BACKEND / 'node')
        (BACKEND / 'bin').mkdir(mode=0o755)
        with tarfile.open(fileobj=io.BytesIO(rest_data)) as archive:
            member = next(m for m in archive.getmembers() if Path(m.name).name == 'postgrest' and m.isfile())
            handle = archive.extractfile(member)
            if handle is None:
                raise RuntimeError('PostgREST binary missing from archive.')
            install_binary(BACKEND / 'postgrest', handle.read())
        with zipfile.ZipFile(io.BytesIO(bun_data)) as archive:
            install_binary(BACKEND / 'bin/bun', archive.read('bun-linux-x64/bun'))
        INSTALL_PHASE = 'sign-in service compilation'
        print('3/8 Compiling the pinned sign-in service (this can take several minutes)…')
        auth_source = staging / 'auth'
        run(['git', 'clone', '--depth', '1', '--branch', AUTH_VERSION, 'https://github.com/supabase/auth.git', str(auth_source)])
        if run(['git', 'rev-parse', 'HEAD'], cwd=auth_source).strip() != AUTH_COMMIT:
            raise RuntimeError('Auth source revision does not match the reviewed commit.')
        run(['chown', '-R', 'fieldops-auth:fieldops-auth', str(auth_source)])
        cache = staging / 'cache'
        cache.mkdir()
        run(['chown', 'fieldops-auth:fieldops-auth', str(cache)])
        go = str(staging / 'go/go/bin/go')
        build_env = {**os.environ, 'HOME': str(cache), 'GOCACHE': str(cache / 'build'), 'GOPATH': str(cache / 'packages'), 'GOTOOLCHAIN': 'local', 'CGO_ENABLED': '0'}
        run([go, 'mod', 'download'], cwd=auth_source, user='fieldops-auth', env=build_env)
        run([go, 'mod', 'verify'], cwd=auth_source, user='fieldops-auth', env=build_env)
        run([go, 'build', '-buildvcs=false', '-ldflags', f'-X github.com/supabase/auth/internal/utilities.Version={AUTH_VERSION}', '-o', str(auth_source / 'gotrue'), '.'], cwd=auth_source, user='fieldops-auth', env=build_env)
        install_binary(BACKEND / 'gotrue', (auth_source / 'gotrue').read_bytes())
    INSTALL_PHASE = 'database initialization'
    print('4/8 Initializing the private database and keys…')
    postgres_version = check_existing_postgres()
    state = json.loads(STATE.read_text())
    state['postgres_version'] = postgres_version
    state['postgres_mode'] = 'existing'
    STATE.write_text(json.dumps(state))
    passwords = {role: secrets.token_hex(32) for role in ('fieldops_owner', 'supabase_auth_admin', 'authenticator')}
    sql = "SET password_encryption = 'scram-sha-256';\n" + '\n'.join(f"CREATE ROLE {role} LOGIN NOINHERIT PASSWORD '{password}';" for role, password in passwords.items()) + '''
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
GRANT anon, authenticated, service_role TO authenticator;
CREATE DATABASE fieldops OWNER fieldops_owner;
'''
    run(['psql', '-v', 'ON_ERROR_STOP=1', '-q'], user='postgres', data=sql, cwd='/tmp')
    prepare_auth_database()
    shared = secrets.token_hex(32)
    anon, service = jwt(shared, 'anon'), jwt(shared, 'service_role')
    db_url = lambda role: f"postgresql://{role}:{passwords[role]}@127.0.0.1:{PORTS['database']}/fieldops?sslmode=disable"
    auth_env = {'GOTRUE_API_HOST': '127.0.0.1', 'PORT': str(PORTS['auth']), 'API_EXTERNAL_URL': f'https://{values["api"]}/auth/v1', 'GOTRUE_DB_DRIVER': 'postgres', 'DATABASE_URL': db_url('supabase_auth_admin'), 'DB_NAMESPACE': 'auth', 'GOTRUE_SITE_URL': f'https://{values["website"]}', 'GOTRUE_URI_ALLOW_LIST': f'https://{values["website"]}/auth,https://{values["website"]}/reset-password', 'GOTRUE_JWT_SECRET': shared, 'GOTRUE_JWT_EXP': '3600', 'GOTRUE_JWT_AUD': 'authenticated', 'GOTRUE_JWT_DEFAULT_GROUP_NAME': 'authenticated', 'GOTRUE_JWT_ADMIN_ROLES': 'service_role', 'GOTRUE_DISABLE_SIGNUP': 'true', 'GOTRUE_EXTERNAL_EMAIL_ENABLED': 'true', 'GOTRUE_EXTERNAL_PHONE_ENABLED': 'false', 'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED': 'false', 'GOTRUE_MAILER_AUTOCONFIRM': 'false', 'GOTRUE_SMTP_HOST': values['smtp_host'], 'GOTRUE_SMTP_PORT': values['smtp_port'], 'GOTRUE_SMTP_USER': values['smtp_user'], 'GOTRUE_SMTP_PASS': values['smtp_password'], 'GOTRUE_SMTP_ADMIN_EMAIL': values['sender'], 'GOTRUE_SMTP_SENDER_NAME': 'Frontier Field Ops Console', 'GOTRUE_MAILER_URLPATHS_CONFIRMATION': '/auth/v1/verify', 'GOTRUE_MAILER_URLPATHS_RECOVERY': '/auth/v1/verify', 'GOTRUE_MAILER_URLPATHS_INVITE': '/auth/v1/verify', 'GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE': '/auth/v1/verify'}
    environment(CONFIG / 'auth.env', auth_env)
    run([str(BACKEND / 'gotrue'), 'migrate'], user='fieldops-auth', env={**os.environ, **auth_env}, cwd=BACKEND)
    complete_install(values, shared, db_url)


def complete_install(values, shared, db_url):
    global INSTALL_PHASE
    anon, service = jwt(shared, 'anon'), jwt(shared, 'service_role')
    # Application trigger migration requires owner access to auth.users. Migration
    # uses the local PostgreSQL administrator, never the REST/login role.
    run(['psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', 'fieldops'], user='postgres', cwd='/tmp', data='GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;')
    rest_env = {'PGRST_DB_URI': db_url('authenticator'), 'PGRST_DB_SCHEMAS': 'public', 'PGRST_DB_ANON_ROLE': 'anon', 'PGRST_JWT_SECRET': shared, 'PGRST_JWT_SECRET_IS_BASE64': 'false', 'PGRST_JWT_AUD': 'authenticated', 'PGRST_SERVER_HOST': '127.0.0.1', 'PGRST_SERVER_PORT': str(PORTS['rest'])}
    environment(CONFIG / 'rest.env', rest_env)
    # Use a dedicated temporary superuser migration connection; remove it after
    # schema setup so no superuser credentials persist in the app environment.
    migration_password = secrets.token_hex(32)
    app_env = {'FIELD_OPS_STANDALONE': '1', 'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': str(PORTS['web']), 'VITE_SUPABASE_URL': f'https://{values["api"]}', 'VITE_SUPABASE_PUBLISHABLE_KEY': anon, 'SUPABASE_URL': f"http://127.0.0.1:{PORTS['gateway']}", 'SUPABASE_PUBLISHABLE_KEY': anon, 'SUPABASE_SERVICE_ROLE_KEY': service, 'DB_SECRET_KEY': secrets.token_hex(32)}
    environment('/etc/field-ops-console.env', app_env)
    INSTALL_PHASE = 'application dependencies and migrations'
    print('5/8 Installing app dependencies and applying checked-in migrations…')
    run([str(BACKEND / 'bin/bun'), 'install', '--frozen-lockfile'], cwd=APP, user='fieldops-web', env={**os.environ, 'HOME': str(APP), 'PATH': RUNTIME_PATH})
    migration_env = {**os.environ, **app_env, 'PATH': RUNTIME_PATH, 'STANDALONE_DATABASE_URL': f"postgresql://fieldops_migration:{migration_password}@127.0.0.1:{PORTS['database']}/fieldops?sslmode=disable"}
    # Create the temporary superuser only immediately before migrations, inside the
    # cleanup block, so any failure still revokes its login.
    run(['psql', '-v', 'ON_ERROR_STOP=1', '-q'], user='postgres', cwd='/tmp', data=f"CREATE ROLE fieldops_migration LOGIN SUPERUSER PASSWORD '{migration_password}';")
    try:
        run([str(BACKEND / 'bin/bun'), 'run', 'db:migrate:standalone'], cwd=APP, user='fieldops-web', env=migration_env)
        # Reassign app objects to the durable owner before dropping temporary role.
        run(['psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', 'fieldops'], user='postgres', cwd='/tmp', data='REASSIGN OWNED BY fieldops_migration TO fieldops_owner; DROP OWNED BY fieldops_migration;')
    finally:
        # Revoke login even on failure; do not leave a reusable superuser password.
        run(['psql', '-v', 'ON_ERROR_STOP=1', '-q'], user='postgres', cwd='/tmp', data='ALTER ROLE fieldops_migration NOLOGIN PASSWORD NULL;')
    run(['psql', '-v', 'ON_ERROR_STOP=1', '-q'], user='postgres', cwd='/tmp', data='DROP ROLE fieldops_migration;')
    INSTALL_PHASE = 'website build and service startup'
    print('6/8 Building the website and starting private services…')
    run([str(BACKEND / 'bin/bun'), 'run', 'build:standalone'], cwd=APP, user='fieldops-web', env={**os.environ, **app_env, 'HOME': str(APP), 'PATH': RUNTIME_PATH})
    unit('field-ops-auth', str(BACKEND / 'gotrue') + ' serve', CONFIG / 'auth.env', 'fieldops-auth', BACKEND)
    unit('field-ops-rest', str(BACKEND / 'postgrest'), CONFIG / 'rest.env', 'fieldops-rest', BACKEND)
    unit('field-ops-console', str(BACKEND / 'node/bin/node') + ' ' + str(APP / 'deploy/start.mjs'), '/etc/field-ops-console.env', 'fieldops-web', APP, 'field-ops-auth.service field-ops-rest.service')
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'field-ops-auth', 'field-ops-rest', 'field-ops-console'])
    wait_url(f"http://127.0.0.1:{PORTS['auth']}/health")
    wait_url(f"http://127.0.0.1:{PORTS['web']}/")
    INSTALL_PHASE = 'website gateway and HTTPS'
    print('7/8 Configuring the API gateway and trusted HTTPS…')
    configure_nginx(values, anon, service)
    run(['nginx', '-t'])
    run(['systemctl', 'enable', '--now', 'nginx'])
    run(['systemctl', 'reload', 'nginx'])
    # Webroot issuance cannot rewrite unrelated Nginx sites.
    run(['certbot', 'certonly', '--webroot', '-w', str(BACKEND / 'acme'), '--cert-name', 'field-ops-native', '--non-interactive', '--agree-tos', '--email', values['admin'], '-d', values['website'], '-d', values['api']])
    configure_nginx(values, anon, service, tls=True)
    run(['nginx', '-t'])
    run(['systemctl', 'reload', 'nginx'])
    write('/etc/letsencrypt/renewal-hooks/deploy/field-ops-reload', '#!/bin/sh\n/usr/sbin/nginx -t && /bin/systemctl reload nginx\n', 0o755)
    run(['systemctl', 'enable', '--now', 'certbot.timer'])
    INSTALL_PHASE = 'administrator creation and verification'
    print('8/8 Creating the first admin and checking installed services…')
    payload = {'email': values['admin'], 'password': values['password'], 'email_confirm': values['verified'], 'role': 'authenticated'}
    request = urllib.request.Request(f"http://127.0.0.1:{PORTS['auth']}/admin/users", data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + service, 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=30) as response:
        account = json.load(response)
    if not values['verified']:
        # Send a confirmation email using the Auth resend flow, not a password email.
        request = urllib.request.Request(f"http://127.0.0.1:{PORTS['auth']}/resend", data=json.dumps({'type': 'signup', 'email': values['admin']}).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=30):
            pass
    check = run(['psql', '-tAc', "SELECT count(*) FROM public.user_roles WHERE role='admin';", '-d', 'fieldops'], user='postgres', cwd='/tmp').strip()
    if check != '1' or not account.get('id'):
        raise RuntimeError('First administrator role was not confirmed.')
    run([str(BACKEND / 'bin/bun'), 'run', 'check:standalone'], cwd=APP, user='fieldops-web', env={**os.environ, **app_env, 'HOME': str(APP), 'PATH': RUNTIME_PATH})
    for url in (f'https://{values["website"]}/', f'https://{values["api"]}/auth/v1/health'):
        wait_url(url)
    verify_public_api(values, anon, account)
    state = json.loads(STATE.read_text())
    state['status'] = 'installed'
    STATE.write_text(json.dumps(state))
    values['password'] = ''
    print(f'Installed: https://{values["website"]}')
    print('Sign in with the administrator email and password you entered; confirm the email first if requested.')
    print('Next: configure Console Connect and Okta; enroll the Network Helper from Admin Settings on a machine with router access.')
    print('Back up /etc/field-ops, /etc/field-ops-console.env and the PostgreSQL database securely. Do not share their contents.')
    print('This installer is not an upgrade tool. Complete the VM acceptance checklist before allowing operational access.')


def resume_state():
    """Accept only the exact pre-REST checkpoint; never overwrite later state."""
    for path in (CONFIG, STATE, CONFIG / 'auth.env', APP, BACKEND):
        if path.is_symlink() or not path.exists() or path.stat().st_uid != 0:
            # The installed app is intentionally owned by its dedicated account.
            if path != APP or path.is_symlink() or not path.is_dir() or path.stat().st_uid != pwd.getpwnam('fieldops-web').pw_uid:
                raise RuntimeError('Continuation refused: installation path ownership or type changed.')
    if not STATE.is_file() or not (CONFIG / 'auth.env').is_file() or not APP.is_dir() or not BACKEND.is_dir():
        raise RuntimeError('Continuation refused: invalid installation path types.')
    if (CONFIG / 'auth.env').stat().st_mode & 0o077:
        raise RuntimeError('Continuation refused: sign-in settings are not private.')
    state = json.loads(STATE.read_text())
    ports = state.get('ports', {})
    if state.get('status') != 'installing' or set(ports) != set(PORTS) or ports.get('database') != 5432:
        raise RuntimeError('Continuation refused: this is not the supported partial installation.')
    if any(type(p) is not int or not 1 <= p <= 65535 for p in ports.values()) or len(set(ports.values())) != 5:
        raise RuntimeError('Continuation refused: saved ports are invalid.')
    for path in (CONFIG / 'rest.env', Path('/etc/field-ops-console.env'),
                 Path('/etc/nginx/sites-available/field-ops-native'), Path('/etc/nginx/sites-enabled/field-ops-native'),
                 Path('/etc/nginx/conf.d/field-ops-keys.conf'), Path('/etc/letsencrypt/live/field-ops-native'),
                 Path('/etc/letsencrypt/archive/field-ops-native'), Path('/etc/letsencrypt/renewal/field-ops-native.conf'),
                 *(Path('/etc/systemd/system') / (name + '.service') for name in ('field-ops-auth', 'field-ops-rest', 'field-ops-console'))):
        if path.exists() or path.is_symlink():
            raise RuntimeError('Continuation refused: later installation state exists; preserve it for manual recovery.')
    settings = {}
    for line in (CONFIG / 'auth.env').read_text().splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in settings:
            raise RuntimeError('Continuation refused: invalid private settings format.')
        settings[key] = json.loads(value)
    website, api = domain(state['website']), domain(state['api'])
    url = urlsplit(settings['DATABASE_URL'])
    if url.hostname != '127.0.0.1' or url.port != 5432 or url.path != '/fieldops' or url.username != 'supabase_auth_admin':
        raise RuntimeError('Continuation refused: sign-in database destination differs.')
    if settings.get('GOTRUE_SITE_URL') != 'https://' + website or settings.get('API_EXTERNAL_URL') != 'https://' + api + '/auth/v1' or settings.get('PORT') != str(ports['auth']) or settings.get('DB_NAMESPACE') != 'auth' or not settings.get('GOTRUE_JWT_SECRET'):
        raise RuntimeError('Continuation refused: sign-in settings differ from saved installation.')
    return state, settings


def resume_after_auth():
    global INSTALL_PHASE
    if os.geteuid() != 0:
        raise RuntimeError('Run continuation with sudo on the target Ubuntu server.')
    # Hold the private directory lock throughout validation and continuation.
    if CONFIG.is_symlink() or not CONFIG.is_dir() or CONFIG.stat().st_uid != 0 or CONFIG.stat().st_mode & 0o077:
        raise RuntimeError('Continuation refused: private installation directory is unsafe.')
    descriptor = os.open('/run/field-ops-resume.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state, auth = resume_state()
        PORTS.update(state['ports'])
        values = {'website': state['website'], 'api': state['api']}
        for user in SERVICE_USERS:
            if service_account(user) is None:
                raise RuntimeError('Continuation refused: a dedicated service account is missing.')
        for path in (BACKEND / 'gotrue', BACKEND / 'postgrest', BACKEND / 'node/bin/node', BACKEND / 'bin/bun'):
            if path.is_symlink() or not path.is_file() or path.stat().st_uid != 0 or path.stat().st_mode & 0o022:
                raise RuntimeError('Continuation refused: native tool missing or unsafe.')
        if not (APP / 'package.json').is_file() or not (APP / 'deploy/migrate.mjs').is_file():
            raise RuntimeError('Continuation refused: installed application source is missing.')
        check_shared_host(values)
        if (set(PORTS.values()) - {5432}) & occupied_ports(run(['ss', '-H', '-ltn'], quiet=True)):
            raise RuntimeError('Continuation refused: a saved private service port is occupied.')
        check = run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', 'fieldops'], user='postgres', cwd='/tmp', data="""
SELECT (to_regclass('auth.users') IS NOT NULL AND to_regprocedure('auth.jwt()') IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public')
 AND NOT EXISTS (SELECT 1 FROM auth.users)
 AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fieldops_migration'));
""").strip()
        if check != 't':
            raise RuntimeError('Continuation refused: Auth setup is incomplete or application/account state already exists.')
        print('Continue using existing sign-in settings and installed application source; no downloads or database recreation.')
        values['admin'] = ask('First administrator email', validate=email)
        values['password'] = ask('First administrator password (12+ characters with upper/lowercase, number and symbol)', hidden=True, validate=lambda v: v if strong_password(v) else (_ for _ in ()).throw(ValueError('Use a strong password.')))
        if ask('Confirm administrator password', hidden=True) != values['password']:
            raise RuntimeError('Passwords do not match.')
        values['verified'] = confirm('Mark ONLY this installer-created administrator email as already verified?')
        if not confirm('Back up the database and finish this partial installation now?'):
            return
        INSTALL_PHASE = 'continuation backup'
        backup = CONFIG / ('before-continuation-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '.sql')
        write(backup, run(['pg_dump', '-p', '5432', '-d', 'fieldops'], user='postgres', cwd='/tmp'), 0o600)
        # Only the REST role password was lost before its settings were saved.
        # Generate that role's password; retain the existing Auth signing key.
        password = secrets.token_hex(32)
        run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-d', 'fieldops'], user='postgres', cwd='/tmp', data="SET password_encryption = 'scram-sha-256';\nALTER ROLE authenticator PASSWORD '" + password + "';")
        db_url = lambda role: f'postgresql://{role}:{password}@127.0.0.1:5432/fieldops?sslmode=disable'
        complete_install(values, auth['GOTRUE_JWT_SECRET'], db_url)


def configure_nginx(values, anon, service, tls=False):
    website, api = values['website'], values['api']
    if not tls:
        (BACKEND / 'acme').mkdir(mode=0o755)
        write('/etc/nginx/conf.d/field-ops-keys.conf', f'''map $http_apikey $field_ops_key_ok {{
    default 0;
    "~^{re.escape(anon)}$" 1;
    "~^{re.escape(service)}$" 1;
}}
map $http_authorization $field_ops_authorization {{
    default $http_authorization;
    "" "Bearer $http_apikey";
}}
map $http_origin $field_ops_origin {{
    default "";
    "https://{website}" "https://{website}";
}}
''')
    common = '''proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Credentials;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;
        proxy_hide_header Access-Control-Expose-Headers;
        proxy_set_header Authorization $field_ops_authorization;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
'''
    gateway = f'''access_log off;
    add_header Access-Control-Allow-Origin $field_ops_origin always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile, x-supabase-api-version" always;
    add_header Access-Control-Expose-Headers "content-range, x-total-count" always;
    add_header Vary Origin always;
    if ($request_method = OPTIONS) {{ return 204; }}
    location ~ ^/auth/v1/(verify|callback|authorize|\\.well-known/jwks\\.json|health)$ {{
        rewrite ^/auth/v1/(.*)$ /$1 break;
        {common}
        proxy_pass http://127.0.0.1:{PORTS['auth']};
    }}
    location /auth/v1/ {{
        if ($field_ops_key_ok = 0) {{ return 401; }}
        {common}
        proxy_pass http://127.0.0.1:{PORTS['auth']}/;
    }}
    location /rest/v1/ {{
        if ($field_ops_key_ok = 0) {{ return 401; }}
        {common}
        proxy_pass http://127.0.0.1:{PORTS['rest']}/;
    }}
    location / {{ return 404; }}
'''
    acme = f'location ^~ /.well-known/acme-challenge/ {{ root {BACKEND / "acme"}; }}'
    listen = '''listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/field-ops-native/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/field-ops-native/privkey.pem;''' if tls else 'listen 80;'
    redirect = f'''server {{
    listen 80;
    server_name {website} {api};
    {acme}
    location / {{ return 301 https://$host$request_uri; }}
}}
''' if tls else ''
    config = redirect + f'''server {{
    listen 127.0.0.1:{PORTS['gateway']};
    server_name localhost;
    {gateway}
}}
server {{
    {listen}
    server_name {api};
    {acme}
    location ^~ /auth/v1/admin {{ return 404; }}
    {gateway}
}}
server {{
    {listen}
    server_name {website};
    {acme}
    location / {{
        proxy_pass http://127.0.0.1:{PORTS['web']};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }}
}}
'''
    site = Path('/etc/nginx/sites-available/field-ops-native')
    if tls:
        # Replace only the file created by this run, never other sites.
        if site.is_symlink():
            raise RuntimeError('Refusing changed Nginx destination.')
        site.write_text(config)
    else:
        write(site, config, 0o600)
        Path('/etc/nginx/sites-enabled/field-ops-native').symlink_to(site)


def verify_public_api(values, anon, account):
    origin = f'https://{values["website"]}'
    base = f'https://{values["api"]}'
    headers = {'apikey': anon, 'Origin': origin, 'Content-Type': 'application/json'}
    request = urllib.request.Request(base + '/auth/v1/settings', headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.headers.get_all('Access-Control-Allow-Origin') != [origin]:
            raise RuntimeError('Public API browser-origin headers were not verified.')
        auth_settings = json.load(response)
    if auth_settings.get('disable_signup') is not True:
        raise RuntimeError('Public signup is not closed.')
    if bool(account.get('email_confirmed_at')) != values['verified']:
        raise RuntimeError('Administrator email confirmation does not match your choice.')
    preflight_request = urllib.request.Request(base + '/auth/v1/token', method='OPTIONS', headers={'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,apikey,content-type'})
    with urllib.request.urlopen(preflight_request, timeout=30) as response:
        if response.status != 204 or response.headers.get_all('Access-Control-Allow-Origin') != [origin]:
            raise RuntimeError('Browser sign-in preflight failed.')
    if not values['verified']:
        print('Email confirmation required: complete password sign-in and saved-data checks after clicking the email link.')
        return
    request = urllib.request.Request(base + '/auth/v1/token?grant_type=password', data=json.dumps({'email': values['admin'], 'password': values['password']}).encode(), headers=headers, method='POST')
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.headers.get_all('Access-Control-Allow-Origin') != [origin]:
            raise RuntimeError('Password sign-in browser-origin headers failed.')
        session = json.load(response)
    token = session.get('access_token')
    if not token or session.get('user', {}).get('id') != account['id']:
        raise RuntimeError('Administrator password sign-in failed.')
    user_headers = {**headers, 'Authorization': 'Bearer ' + token}
    request = urllib.request.Request(base + '/rest/v1/profiles?select=id', headers=user_headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        rows = json.load(response)
    if not any(row.get('id') == account['id'] for row in rows):
        raise RuntimeError('Authenticated administrator data access failed.')
    request = urllib.request.Request(base + '/auth/v1/logout', data=b'{}', headers=user_headers, method='POST')
    with urllib.request.urlopen(request, timeout=30):
        pass


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError) as error:
        print(f'Installation stopped: {error}', file=sys.stderr)
        sys.exit(1)
    except (EOFError, KeyboardInterrupt):
        print('\nCancelled. If installation had begun, do not delete database or secret files to retry.', file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(failure_summary(error), file=sys.stderr)
        sys.exit(1)