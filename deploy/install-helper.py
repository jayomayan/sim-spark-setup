"""Native helper installation shared by the interactive Ubuntu installer."""
import hashlib
import io
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import tarfile
import urllib.request

PREFIX = Path('/opt/field-ops-helper')
ENV = Path('/etc/field-ops-helper.env')
UNIT = Path('/etc/systemd/system/field-ops-helper.service')
USER = 'fieldops-helper'


def console_url(value):
    from urllib.parse import urlsplit
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ValueError('Use the console HTTPS address without a path, credentials or custom port.')
    return 'https://' + parsed.hostname.lower()


def preflight(api):
    if os.geteuid() != 0:
        raise RuntimeError('Run helper installation with sudo.')
    if 'ID=ubuntu' not in Path('/etc/os-release').read_text().replace('"', ''):
        raise RuntimeError('Helper installation requires Ubuntu.')
    if os.uname().machine != 'x86_64' or not Path('/run/systemd/system').exists():
        raise RuntimeError('Helper installation requires x86_64 and systemd.')
    if not hasattr(tarfile, 'data_filter'):
        raise RuntimeError('Use a newer Python with safe archive extraction support.')
    for path in (PREFIX, ENV, UNIT):
        if path.exists() or path.is_symlink():
            raise RuntimeError('Helper installation refused: existing helper files or partial state. Preserve them.')
    try:
        pwd.getpwnam(USER)
    except KeyError:
        pass
    else:
        raise RuntimeError('Helper installation refused: dedicated helper account already exists.')
    if not shutil.which('apt-get') or not shutil.which('systemctl'):
        raise RuntimeError('Ubuntu package tools and systemd are required.')


def settings(api, default=''):
    print('Install only on a machine that can reach your routers; no inbound helper ports are required.')
    url = api.ask('Console HTTPS address', default, console_url)
    if not api.confirm('Can this machine reach the routers over your network or VPN?'):
        raise RuntimeError('Helper installation cancelled: use a machine on the router network.')
    return {'console': url}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def enroll(url, code):
    request = urllib.request.Request(url + '/api/public/helper/enroll',
        data=json.dumps({'code': code}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            token = json.load(response).get('token')
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{20,512}', token):
            raise ValueError()
        return token
    except Exception:
        raise RuntimeError('Helper enrollment failed; raw output withheld. Preserve partial files and generate a new code before recovery.') from None


def install(api, values):
    preflight(api)
    source = Path(api.__file__).resolve().parent.parent / 'public/helper'
    for name in ('field-ops-helper.mjs', 'package.json', 'README.md'):
        if not (source / name).is_file() or (source / name).is_symlink():
            raise RuntimeError('Reviewed helper source files are missing.')
    name = f'node-v{api.NODE_VERSION}-linux-x64.tar.xz'
    sums = api.download(f'https://nodejs.org/dist/v{api.NODE_VERSION}/SHASUMS256.txt').decode()
    expected = next((line.split()[0] for line in sums.splitlines() if line.split()[-1] == name), None)
    content = api.download(f'https://nodejs.org/dist/v{api.NODE_VERSION}/{name}')
    if not expected or hashlib.sha256(content).hexdigest() != expected:
        raise RuntimeError('Helper Node checksum mismatch; nothing installed.')
    print('Installing helper packages and private runtime…')
    env = {**os.environ, 'DEBIAN_FRONTEND': 'noninteractive', 'NEEDRESTART_MODE': 'l'}
    api.run(['apt-get', 'update'], env=env, quiet=True)
    api.run(['apt-get', 'install', '-y', '--no-upgrade', 'ca-certificates', 'snmp', 'iputils-ping'], env=env, quiet=True)
    # Recheck after downloads/packages to refuse newly appeared resources.
    preflight(api)
    PREFIX.mkdir(mode=0o755)
    with tarfile.open(fileobj=io.BytesIO(content), mode='r:xz') as archive:
        archive.extractall(PREFIX, filter='data')
    runtime = PREFIX / f'node-v{api.NODE_VERSION}-linux-x64'
    api.run(['useradd', '--system', '--home', str(PREFIX), '--shell', '/usr/sbin/nologin', USER], quiet=True)
    for name in ('field-ops-helper.mjs', 'package.json', 'README.md'):
        shutil.copyfile(source / name, PREFIX / name)
    api.run(['chown', '-R', USER + ':' + USER, str(PREFIX)], quiet=True)
    path = str(runtime / 'bin') + ':/usr/bin:/bin'
    child_env = {**os.environ, 'PATH': path, 'HOME': str(PREFIX), 'PLAYWRIGHT_BROWSERS_PATH': str(PREFIX / 'browsers')}
    api.run([str(runtime / 'bin/npm'), 'install', '--no-audit', '--no-fund'], cwd=PREFIX, user=USER, env=child_env, quiet=True)
    api.run([str(runtime / 'bin/npx'), 'playwright', 'install-deps', 'chromium'], cwd=PREFIX, env={**child_env, **{k: env[k] for k in ('DEBIAN_FRONTEND', 'NEEDRESTART_MODE')}}, quiet=True)
    api.run([str(runtime / 'bin/npx'), 'playwright', 'install', 'chromium'], cwd=PREFIX, user=USER, env=child_env, quiet=True)
    print('In Admin Settings → Network Helper, generate a new one-time installation code.')
    code = api.ask('One-time installation code (hidden)', hidden=True)
    token = enroll(values['console'], code)
    code = ''
    api.environment(ENV, {'CONSOLE_URL': values['console'], 'AGENT_TOKEN': token,
        'PLAYWRIGHT_BROWSERS_PATH': str(PREFIX / 'browsers'), 'PATH': path})
    token = ''
    api.write(UNIT, f'''[Unit]
Description=Field Ops Console network helper
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User={USER}
WorkingDirectory={PREFIX}
EnvironmentFile={ENV}
ExecStart={runtime / 'bin/node'} {PREFIX / 'field-ops-helper.mjs'}
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
''', 0o644)
    api.run(['systemctl', 'daemon-reload'], quiet=True)
    api.run(['systemctl', 'enable', '--now', 'field-ops-helper'], quiet=True)
    api.run(['systemctl', 'is-active', '--quiet', 'field-ops-helper'], quiet=True)
    print('Helper service started. Verify its online status in Admin Settings before router operations.')