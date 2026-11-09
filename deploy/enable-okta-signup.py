#!/usr/bin/env python3
"""Enable verified Okta registration only after the app migration is installed."""
import os
import re
import shutil
import stat
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SETTINGS = {
    'GOTRUE_DISABLE_SIGNUP': 'false',
    'GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED': 'true',
    'GOTRUE_HOOK_BEFORE_USER_CREATED_URI': 'pg-functions://postgres/public/before_staff_user_created',
}


def updated_settings(text):
    for key in ('GOTRUE_HOOK_BEFORE_USER_CREATED_URI', 'GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED'):
        match = re.search(r'^' + key + r'=(.*)$', text, re.M)
        if match and match.group(1).strip().strip('\"\'') not in (SETTINGS[key], 'false', ''):
            raise ValueError('An existing registration hook must be reviewed first.')
    for key, value in SETTINGS.items():
        text, count = re.subn(r'^' + key + r'=.*$', key + '=' + value, text, flags=re.M)
        if count > 1:
            raise ValueError('Duplicate sign-in settings; review privately first.')
        if count == 0:
            text = text.rstrip('\n') + '\n' + key + '=' + value + '\n'
    return text


def main():
    if os.geteuid() != 0:
        raise ValueError('Run this command with sudo.')
    path = Path('/etc/field-ops/auth.env')
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('Private sign-in settings are missing or unsafe.')
    text = path.read_text()
    updated = updated_settings(text)
    # Peer-authenticated local check; never load or print database passwords.
    query = "SELECT to_regprocedure('public.before_staff_user_created(jsonb)') IS NOT NULL AND to_regprocedure('public.ensure_okta_access()') IS NOT NULL;"
    result = subprocess.run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-d', 'fieldops', '-c', query], cwd='/tmp', capture_output=True, text=True)
    if result.returncode or result.stdout.strip() != 't':
        raise ValueError('Upgrade the app and apply its Okta account migration first.')
    print('Allow new verified Okta staff accounts; password registration stays blocked by the staff-only hook.')
    if input('Type ENABLE to continue: ').strip() != 'ENABLE':
        print('Cancelled; no changes made.')
        return
    backup = Path('/var/backups/field-ops-okta-' + datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S'))
    backup.mkdir(mode=0o700)
    shutil.copy2(path, backup / 'auth.env')
    info = path.stat()
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.auth-okta-')
    try:
        os.fchmod(fd, stat.S_IMODE(info.st_mode))
        os.fchown(fd, info.st_uid, info.st_gid)
        with os.fdopen(fd, 'w') as output:
            output.write(updated)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
        result = subprocess.run(['systemctl', 'restart', 'field-ops-auth'], capture_output=True)
        if result.returncode:
            shutil.copy2(backup / 'auth.env', path)
            subprocess.run(['systemctl', 'restart', 'field-ops-auth'], capture_output=True)
            raise ValueError('Restart failed; previous sign-in settings restored. Check the service privately.')
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print('Okta registration enabled. Test a new staff login and an existing same-email local account; no credentials displayed.')


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print('Stopped:', error)
        raise SystemExit(1)
    except Exception:
        print('Stopped: check private settings and the sign-in service; no credentials displayed.')
        raise SystemExit(1)