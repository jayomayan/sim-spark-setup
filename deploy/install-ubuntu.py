#!/usr/bin/env python3
"""Interactive, native Ubuntu installer. Run on a fresh dedicated VM only.

No secrets are passed in command arguments or printed. --dry-run asks the same
questions but makes no system changes. This is not an upgrade/migration tool.
"""
import argparse
import base64
import getpass
import hashlib
import hmac
import io
import json
import os
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
    print('Fresh dedicated Ubuntu 24.04 VM only. Existing installations are never overwritten.')
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


def run(args, *, data=None, cwd=None, user=None, env=None, quiet=False):
    if user:
        args = ['runuser', '-u', user, '--', *args]
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


def preflight():
    if os.geteuid() != 0:
        raise RuntimeError('Run this installer with sudo on your target VM.')
    release = dict(line.strip().split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    if release.get('ID', '').strip('"') != 'ubuntu' or release.get('VERSION_ID', '').strip('"') != '24.04':
        raise RuntimeError('This installer supports Ubuntu 24.04 LTS only.')
    if os.uname().machine != 'x86_64':
        raise RuntimeError('This initial installer supports x86_64 VMs only.')
    if not Path('/run/systemd/system').exists():
        raise RuntimeError('A running systemd installation is required.')
    for path in (APP, BACKEND, CONFIG, Path('/etc/field-ops-console.env'), Path('/etc/nginx/sites-available/field-ops-native'), Path('/etc/nginx/sites-enabled/field-ops-native'), Path('/etc/nginx/conf.d/field-ops-keys.conf'), *(Path('/etc/systemd/system') / f'{name}.service' for name in ('field-ops-console', 'field-ops-auth', 'field-ops-rest')), *(Path('/usr/local/bin') / name for name in ('node', 'npm', 'npx', 'bun'))):
        if path.exists() or path.is_symlink():
            raise RuntimeError(f'Existing destination detected: {path}. This is a fresh-install script, not an upgrade tool.')
    if shutil.disk_usage('/opt').free < 12 * 1024**3:
        raise RuntimeError('At least 12 GB free disk space is needed for source and build tools.')
    # Avoid taking over unrelated listeners or a pre-existing database/cluster.
    listeners = run(['ss', '-H', '-ltn'], quiet=True)
    if re.search(r':(?:3000|5432|8000|9999|3001)\s', listeners):
        raise RuntimeError('A required port is already occupied; use a fresh dedicated VM.')
    if Path('/etc/postgresql').exists() and any(Path('/etc/postgresql').iterdir()):
        raise RuntimeError('An existing PostgreSQL cluster was found; it will not be modified.')
    for user in ('fieldops-web', 'fieldops-auth', 'fieldops-rest'):
        import pwd
        try:
            pwd.getpwnam(user)
        except KeyError:
            continue
        raise RuntimeError('An installer service account already exists; use a fresh VM.')
    source = Path(__file__).resolve().parent.parent
    for path in ('package.json', 'bun.lock', 'deploy/build.mjs', 'deploy/migrate.mjs', 'drizzle/migrations/meta/_journal.json'):
        if not (source / path).is_file():
            raise RuntimeError('Run the installer from a complete reviewed repository checkout.')
    return source


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Prompt and validate only; do not install or write settings')
    args = parser.parse_args()
    source = None if args.dry_run else preflight()
    values = settings()
    print(f'\nWebsite: https://{values["website"]}\nAPI: https://{values["api"]}')
    print('Services: PostgreSQL, Auth, PostgREST, Nginx, Node website; HTTPS certificates and first admin.')
    print('Downloads use pinned versions; unavailable checksums stop installation, never bypass verification.')
    if args.dry_run:
        print('Dry run complete. No packages, files, accounts, certificates or services changed.')
        return
    if not confirm('Install these services on this fresh VM now?'):
        print('Cancelled. No system changes made.')
        return
    install(source, values)


def install(source, values):
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
    write(STATE, json.dumps({'status': 'installing', 'website': values['website'], 'api': values['api'], 'versions': {'node': NODE_VERSION, 'auth': AUTH_VERSION, 'rest': REST_VERSION, 'bun': BUN_VERSION}}))
    print('2/8 Installing Ubuntu packages and service accounts…')
    run(['apt-get', 'update'])
    run(['apt-get', 'install', '-y', 'ca-certificates', 'curl', 'git', 'make', 'xz-utils', 'unzip', 'postgresql', 'postgresql-contrib', 'nginx', 'certbot', 'python3-certbot-nginx'], env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'})
    for user in ('fieldops-web', 'fieldops-auth', 'fieldops-rest'):
        run(['useradd', '--system', '--user-group', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', user])
    BACKEND.mkdir(mode=0o755)
    APP.mkdir(mode=0o755)
    # Exclude repository metadata and hosted credentials at every depth.
    shutil.copytree(source, APP, dirs_exist_ok=True, ignore=shutil.ignore_patterns('.git', '.env', '.env.*', 'node_modules', '.output', 'dist', '.tanstack', '.lovable', '.workspace', '__pycache__'))
    run(['chown', '-R', 'fieldops-web:fieldops-web', str(APP)])
    with tempfile.TemporaryDirectory(prefix='field-ops-install-') as temp:
        staging = Path(temp)
        os.chmod(staging, 0o755)
        for content, target in ((node_data, staging / 'node'), (go_data, staging / 'go')):
            target.mkdir()
            with tarfile.open(fileobj=io.BytesIO(content)) as archive:
                archive.extractall(target, filter='data')
        shutil.copytree(staging / 'node' / f'node-v{NODE_VERSION}-linux-x64', BACKEND / 'node')
        for executable in ('node', 'npm', 'npx'):
            path = Path('/usr/local/bin') / executable
            if path.exists() or path.is_symlink():
                raise RuntimeError('An existing Node installation was found; refusing to replace it.')
            path.symlink_to(BACKEND / 'node/bin' / executable)
        with tarfile.open(fileobj=io.BytesIO(rest_data)) as archive:
            member = next(m for m in archive.getmembers() if Path(m.name).name == 'postgrest' and m.isfile())
            handle = archive.extractfile(member)
            if handle is None:
                raise RuntimeError('PostgREST binary missing from archive.')
            install_binary(BACKEND / 'postgrest', handle.read())
        with zipfile.ZipFile(io.BytesIO(bun_data)) as archive:
            install_binary('/usr/local/bin/bun', archive.read('bun-linux-x64/bun'))
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
    print('4/8 Initializing the private database and keys…')
    run(['systemctl', 'enable', '--now', 'postgresql'])
    passwords = {role: secrets.token_hex(32) for role in ('fieldops_owner', 'supabase_auth_admin', 'authenticator')}
    sql = '\n'.join(f"CREATE ROLE {role} LOGIN NOINHERIT PASSWORD '{password}';" for role, password in passwords.items()) + '''
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
GRANT anon, authenticated, service_role TO authenticator;
CREATE DATABASE fieldops OWNER fieldops_owner;
'''
    run(['psql', '-v', 'ON_ERROR_STOP=1', '-q'], user='postgres', data=sql, cwd='/tmp')
    run(['psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', 'fieldops'], user='postgres', cwd='/tmp', data='''
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
GRANT CONNECT ON DATABASE fieldops TO supabase_auth_admin, authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
''')
    shared = secrets.token_hex(32)
    anon, service = jwt(shared, 'anon'), jwt(shared, 'service_role')
    db_url = lambda role: f'postgresql://{role}:{passwords[role]}@127.0.0.1:5432/fieldops?sslmode=disable'
    auth_env = {'GOTRUE_API_HOST': '127.0.0.1', 'PORT': '9999', 'API_EXTERNAL_URL': f'https://{values["api"]}/auth/v1', 'GOTRUE_DB_DRIVER': 'postgres', 'DATABASE_URL': db_url('supabase_auth_admin'), 'DB_NAMESPACE': 'auth', 'GOTRUE_SITE_URL': f'https://{values["website"]}', 'GOTRUE_URI_ALLOW_LIST': f'https://{values["website"]}/auth,https://{values["website"]}/reset-password', 'GOTRUE_JWT_SECRET': shared, 'GOTRUE_JWT_EXP': '3600', 'GOTRUE_JWT_AUD': 'authenticated', 'GOTRUE_JWT_DEFAULT_GROUP_NAME': 'authenticated', 'GOTRUE_JWT_ADMIN_ROLES': 'service_role', 'GOTRUE_DISABLE_SIGNUP': 'true', 'GOTRUE_EXTERNAL_EMAIL_ENABLED': 'true', 'GOTRUE_EXTERNAL_PHONE_ENABLED': 'false', 'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED': 'false', 'GOTRUE_MAILER_AUTOCONFIRM': 'false', 'GOTRUE_SMTP_HOST': values['smtp_host'], 'GOTRUE_SMTP_PORT': values['smtp_port'], 'GOTRUE_SMTP_USER': values['smtp_user'], 'GOTRUE_SMTP_PASS': values['smtp_password'], 'GOTRUE_SMTP_ADMIN_EMAIL': values['sender'], 'GOTRUE_SMTP_SENDER_NAME': 'Frontier Field Ops Console', 'GOTRUE_MAILER_URLPATHS_CONFIRMATION': '/auth/v1/verify', 'GOTRUE_MAILER_URLPATHS_RECOVERY': '/auth/v1/verify', 'GOTRUE_MAILER_URLPATHS_INVITE': '/auth/v1/verify', 'GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE': '/auth/v1/verify'}
    environment(CONFIG / 'auth.env', auth_env)
    run([str(BACKEND / 'gotrue'), 'migrate'], user='fieldops-auth', env={**os.environ, **auth_env}, cwd=BACKEND)
    # Application trigger migration requires owner access to auth.users. Migration
    # uses the local PostgreSQL administrator, never the REST/login role.
    run(['psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', 'fieldops'], user='postgres', cwd='/tmp', data='GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;')
    rest_env = {'PGRST_DB_URI': db_url('authenticator'), 'PGRST_DB_SCHEMAS': 'public', 'PGRST_DB_ANON_ROLE': 'anon', 'PGRST_JWT_SECRET': shared, 'PGRST_JWT_SECRET_IS_BASE64': 'false', 'PGRST_JWT_AUD': 'authenticated', 'PGRST_SERVER_HOST': '127.0.0.1', 'PGRST_SERVER_PORT': '3001'}
    environment(CONFIG / 'rest.env', rest_env)
    # Use a dedicated temporary superuser migration connection; remove it after
    # schema setup so no superuser credentials persist in the app environment.
    migration_password = secrets.token_hex(32)
    run(['psql', '-v', 'ON_ERROR_STOP=1', '-q'], user='postgres', cwd='/tmp', data=f"CREATE ROLE fieldops_migration LOGIN SUPERUSER PASSWORD '{migration_password}';")
    app_env = {'FIELD_OPS_STANDALONE': '1', 'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': '3000', 'VITE_SUPABASE_URL': f'https://{values["api"]}', 'VITE_SUPABASE_PUBLISHABLE_KEY': anon, 'SUPABASE_URL': 'http://127.0.0.1:8000', 'SUPABASE_PUBLISHABLE_KEY': anon, 'SUPABASE_SERVICE_ROLE_KEY': service, 'DB_SECRET_KEY': secrets.token_hex(32)}
    environment('/etc/field-ops-console.env', app_env)
    print('5/8 Installing app dependencies and applying checked-in migrations…')
    run(['/usr/local/bin/bun', 'install', '--frozen-lockfile'], cwd=APP, user='fieldops-web', env={**os.environ, 'HOME': str(APP)})
    migration_env = {**os.environ, **app_env, 'STANDALONE_DATABASE_URL': f'postgresql://fieldops_migration:{migration_password}@127.0.0.1:5432/fieldops?sslmode=disable'}
    try:
        run(['/usr/local/bin/bun', 'run', 'db:migrate:standalone'], cwd=APP, user='fieldops-web', env=migration_env)
        # Reassign app objects to the durable owner before dropping temporary role.
        run(['psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', 'fieldops'], user='postgres', cwd='/tmp', data='REASSIGN OWNED BY fieldops_migration TO fieldops_owner; DROP OWNED BY fieldops_migration;')
    finally:
        # Revoke login even on failure; do not leave a reusable superuser password.
        run(['psql', '-v', 'ON_ERROR_STOP=1', '-q'], user='postgres', cwd='/tmp', data='ALTER ROLE fieldops_migration NOLOGIN PASSWORD NULL;')
    run(['psql', '-v', 'ON_ERROR_STOP=1', '-q'], user='postgres', cwd='/tmp', data='DROP ROLE fieldops_migration;')
    print('6/8 Building the website and starting private services…')
    run(['/usr/local/bin/bun', 'run', 'build:standalone'], cwd=APP, user='fieldops-web', env={**os.environ, **app_env, 'HOME': str(APP)})
    unit('field-ops-auth', str(BACKEND / 'gotrue') + ' serve', CONFIG / 'auth.env', 'fieldops-auth', BACKEND)
    unit('field-ops-rest', str(BACKEND / 'postgrest'), CONFIG / 'rest.env', 'fieldops-rest', BACKEND)
    unit('field-ops-console', '/usr/local/bin/node ' + str(APP / 'deploy/start.mjs'), '/etc/field-ops-console.env', 'fieldops-web', APP, 'field-ops-auth.service field-ops-rest.service')
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'field-ops-auth', 'field-ops-rest', 'field-ops-console'])
    wait_url('http://127.0.0.1:9999/health')
    wait_url('http://127.0.0.1:3000/')
    print('7/8 Configuring the API gateway and trusted HTTPS…')
    configure_nginx(values, anon, service)
    run(['nginx', '-t'])
    run(['systemctl', 'enable', '--now', 'nginx'])
    run(['systemctl', 'reload', 'nginx'])
    run(['certbot', '--nginx', '--non-interactive', '--agree-tos', '--redirect', '--email', values['admin'], '-d', values['website'], '-d', values['api']])
    run(['systemctl', 'enable', '--now', 'certbot.timer'])
    print('8/8 Creating the first admin and checking installed services…')
    payload = {'email': values['admin'], 'password': values['password'], 'email_confirm': values['verified'], 'role': 'authenticated'}
    request = urllib.request.Request('http://127.0.0.1:9999/admin/users', data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + service, 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=30) as response:
        account = json.load(response)
    if not values['verified']:
        # Send a confirmation email using the Auth resend flow, not a password email.
        request = urllib.request.Request('http://127.0.0.1:9999/resend', data=json.dumps({'type': 'signup', 'email': values['admin']}).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=30):
            pass
    check = run(['psql', '-tAc', "SELECT count(*) FROM public.user_roles WHERE role='admin';", '-d', 'fieldops'], user='postgres', cwd='/tmp').strip()
    if check != '1' or not account.get('id'):
        raise RuntimeError('First administrator role was not confirmed.')
    run(['/usr/local/bin/bun', 'run', 'check:standalone'], cwd=APP, user='fieldops-web', env={**os.environ, **app_env, 'HOME': str(APP)})
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


def configure_nginx(values, anon, service):
    website, api = values['website'], values['api']
    write('/etc/nginx/conf.d/field-ops-keys.conf', f'''map $http_apikey $field_ops_key_ok {{
    default 0;
    "{anon}" 1;
    "{service}" 1;
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
        proxy_pass http://127.0.0.1:9999;
    }}
    location /auth/v1/ {{
        if ($field_ops_key_ok = 0) {{ return 401; }}
        {common}
        proxy_pass http://127.0.0.1:9999/;
    }}
    location /rest/v1/ {{
        if ($field_ops_key_ok = 0) {{ return 401; }}
        {common}
        proxy_pass http://127.0.0.1:3001/;
    }}
    location / {{ return 404; }}
'''
    write('/etc/nginx/sites-available/field-ops-native', f'''server {{
    listen 127.0.0.1:8000;
    server_name localhost;
    {gateway}
}}
server {{
    listen 80;
    server_name {api};
    location ^~ /auth/v1/admin {{ return 404; }}
    {gateway}
}}
server {{
    listen 80;
    server_name {website};
    location / {{
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }}
}}
''', 0o600)
    Path('/etc/nginx/sites-enabled/field-ops-native').symlink_to('/etc/nginx/sites-available/field-ops-native')


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
    except Exception:
        print('Installation stopped. No secret values were printed. Inspect services privately and preserve partial state; do not rerun over it.', file=sys.stderr)
        sys.exit(1)