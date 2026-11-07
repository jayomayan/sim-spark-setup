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

APP = Path('/opt/field-ops-console')
BACKEND = Path('/opt/field-ops-backend')
CONFIG = Path('/etc/field-ops')
STATE = CONFIG / 'installation.json'
NODE_VERSION = '22.22.0'
AUTH_VERSION = 'v2.196.0'
REST_VERSION = 'v12.2.12'
BUN_VERSION = 'bun-v1.3.3'


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
    return len(value) >= 12 and len(value) <= 128 and all((re.search(r'[a-z]', value), re.search(r'[A-Z]', value), re.search(r'[0-9]', value), re.search(r'[^a-zA-Z0-9]', value))) and not any(c in value for c in '\r\n\x00')


def env_value(value):
    if any(c in value for c in '\r\n\x00'):
        raise ValueError('Multiline settings are not supported.')
    # Compatible with both systemd EnvironmentFile and a shell's source command.
    return "'" + value.replace("'", "'\\''") + "'"


def jwt(secret, role, now=None):
    now = int(time.time()) if now is None else now
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=').decode()
    header = encode(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    body = encode(json.dumps({'role': role, 'iss': 'supabase', 'iat': now, 'exp': now + 10 * 365 * 86400}, separators=(',', ':')).encode())
    message = header + '.' + body
    return message + '.' + encode(hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest())


def ask(label, default='', validate=None, hidden=False):
    while True:
        prompt = label + (f' [{default}]' if default else '') + ': '
        value = (getpass.getpass(prompt) if hidden else input(prompt)).strip() or default
        try:
            if not value:
                raise ValueError('This value is required.')
            if any(c in value for c in '\r\n\x00'):
                raise ValueError('Use a single-line value.')
            return validate(value) if validate else value
        except ValueError as error:
            print(error)


def yes(label, default=False):
    return input(label + (' [Y/n]: ' if default else ' [y/N]: ')).strip().lower() in ('y', 'yes') or (default and not False if False else False)  # replaced below by explicit parsing


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
    if not asset or not asset.get('digest', '').startswith('sha256:'):
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
    for path in (APP, BACKEND, CONFIG, Path('/etc/field-ops-console.env'), Path('/etc/nginx/sites-available/field-ops-native'), Path('/etc/systemd/system/field-ops-console.service')):
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
    raise RuntimeError('Installation steps are not yet available.')


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