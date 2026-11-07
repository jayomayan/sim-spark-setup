"""Safe unit checks: never run installation commands or change services."""
import base64
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native_installer', Path(__file__).with_name('install-ubuntu.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerChecks(unittest.TestCase):
    def test_native_plan_accepts_dns_not_command_injection(self):
        self.assertEqual(installer.domain('Ops.Example.com'), 'ops.example.com')
        for value in ('https://ops.example.com', 'ops.example.com;id', 'ops.example.com/path', 'ops.example.com\nserver{}', '127.0.0.1', '-bad.example.com'):
            with self.assertRaises(ValueError):
                installer.domain(value)

    def test_strong_admin_password_matches_app_rules(self):
        self.assertTrue(installer.strong_password('Example-Admin93!'))
        for value in ('shortA1!', 'lowercaseonly93!', 'NOLOWERCASE93!', 'NoNumberHere!', 'NoSymbolHere93', 'OnlySpaceHere93 '):
            self.assertFalse(installer.strong_password(value))

    def test_jwt_roles_signed_separately(self):
        secret = 'unit-test-key'
        public = installer.jwt(secret, 'anon', now=100)
        admin = installer.jwt(secret, 'service_role', now=100)
        self.assertNotEqual(public, admin)
        for token, role in ((public, 'anon'), (admin, 'service_role')):
            header, body, signature = token.split('.')
            claims = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
            self.assertEqual(claims['role'], role)
            self.assertEqual(claims['aud'], 'authenticated')
            expected = base64.urlsafe_b64encode(hmac.new(secret.encode(), (header + '.' + body).encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
            self.assertEqual(signature, expected)

    def test_environment_roundtrip_and_private_permissions(self):
        value = 'spaces apostrophe\' double" $dollar `tick` \\slash'
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'settings.env'
            installer.environment(path, {'SAMPLE': value})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            result = subprocess.run(['bash', '-c', 'source "$1"; printf %s "$SAMPLE"', 'bash', str(path)], capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout, value)
            with self.assertRaises(FileExistsError):
                installer.environment(path, {'SAMPLE': 'replacement'})
        with self.assertRaises(ValueError):
            installer.env_value('bad\nsetting')

    def test_dry_run_never_installs_and_prompts_hidden_secrets(self):
        answers = iter(['ops.example.com', 'api.example.com', 'admin@example.com', 'smtp.example.com', '', 'mailer', '', 'n'])
        with patch('sys.argv', ['install-ubuntu.py', '--dry-run']), patch('builtins.input', side_effect=lambda _: next(answers)), patch.object(installer.getpass, 'getpass', side_effect=['Example-Admin93!', 'Example-Admin93!', 'smtp-secret']) as hidden, patch.object(installer, 'install') as install, patch.object(installer, 'preflight') as preflight:
            installer.main()
        self.assertEqual(hidden.call_count, 3)
        install.assert_not_called()
        preflight.assert_not_called()

    def test_unverified_binary_is_not_installed(self):
        release = json.dumps({'assets': [{'name': 'binary', 'browser_download_url': 'https://example.com/binary', 'digest': None}]}).encode()
        with patch.object(installer, 'download', return_value=release):
            with self.assertRaises(RuntimeError):
                installer.release_asset('org/repo', 'v1', 'binary')

    def test_failure_does_not_echo_upstream_credentials(self):
        result = subprocess.CompletedProcess(['tool'], 1, 'secret', 'password=secret')
        with patch.object(installer.subprocess, 'run', return_value=result):
            with self.assertRaises(RuntimeError) as error:
                installer.run(['tool'])
        self.assertNotIn('secret', str(error.exception))


if __name__ == '__main__':
    unittest.main()