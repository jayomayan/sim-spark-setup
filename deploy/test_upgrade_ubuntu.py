"""Upgrade safety tests; no real services or database commands execute."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('upgrade_tool', Path(__file__).with_name('upgrade-ubuntu.py'))
upgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)


class UpgradeChecks(unittest.TestCase):
    def test_migration_history_rejects_changes_and_missing_applied_entries(self):
        self.assertEqual(upgrade.validate_history({'0000_migration': 'old'}, {'0000_migration': 'old', '0001_next': 'new'}), ['0001_next'])
        for proposed in ({}, {'0000_migration': 'changed'}):
            with self.assertRaises(RuntimeError):
                upgrade.validate_history({'0000_migration': 'old'}, proposed)

    def test_environment_reads_literals_without_shell_evaluation(self):
        env = {'FIELD_OPS_STANDALONE': '1', 'VITE_SUPABASE_URL': 'https://api.example.com', 'VITE_SUPABASE_PUBLISHABLE_KEY': 'public', 'SUPABASE_URL': 'http://127.0.0.1:8000', 'SUPABASE_PUBLISHABLE_KEY': 'public', 'SUPABASE_SERVICE_ROLE_KEY': 'private', 'DB_SECRET_KEY': '$literal`not-command`'}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'app.env'
            path.write_text(''.join(f'{key}="{value}"\n' for key, value in env.items()))
            self.assertEqual(upgrade.read_environment(path), env)
            path.write_text(path.read_text() + 'BAD=$(command)\n')
            with self.assertRaises(RuntimeError):
                upgrade.read_environment(path)

    def test_source_copy_excludes_credentials_and_dependencies_at_every_level(self):
        ignored = upgrade.ignore_source('/tmp', ['.git', '.env', '.env.local', 'node_modules', '.output', '.workspace', 'src', 'bun.lock'])
        self.assertEqual(ignored, ['.git', '.env', '.env.local', 'node_modules', '.output', '.workspace'])

    def test_migration_uses_peer_sql_without_superuser_password(self):
        calls = []
        def command(args, **kwargs):
            calls.append((args, kwargs))
            return '{}'
        with patch.object(upgrade, 'run', side_effect=command), patch.object(upgrade, 'source_manifest', return_value={}):
            upgrade.migrate(Path('/tmp/staged'), {})
        self.assertIn('BEGIN;', calls[-1][1]['data'])
        self.assertIn('COMMIT;', calls[-1][1]['data'])
        self.assertEqual(calls[-1][1]['user'], 'postgres')
        self.assertTrue(all('postgresql://' not in ' '.join(args) for args, _ in calls))

    def test_shutdown_attempts_every_service_even_if_one_fails(self):
        with patch.object(upgrade, 'run', side_effect=[RuntimeError('stop failed'), '', '']) as command:
            self.assertEqual(upgrade.stop_services(), ['field-ops-console'])
            self.assertEqual(command.call_count, 3)

    def test_dry_run_does_not_read_settings_or_upgrade(self):
        with patch('sys.argv', ['upgrade-ubuntu.py', '--dry-run']), patch('builtins.input', return_value=''), patch.object(upgrade, 'source_manifest', return_value={'0000_migration': 'hash'}), patch.object(upgrade, 'preflight') as preflight, patch.object(upgrade, 'upgrade') as install:
            upgrade.main()
        preflight.assert_not_called()
        install.assert_not_called()

    def test_private_status_record(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            upgrade.write_status(path, 'migration_started')
            upgrade.write_status(path, 'failed_manual_recovery_required')
            self.assertEqual(json.loads((path / 'upgrade.json').read_text())['status'], 'failed_manual_recovery_required')
            self.assertEqual((path / 'upgrade.json').stat().st_mode & 0o777, 0o600)

    def test_command_failure_hides_credentials(self):
        with patch.object(upgrade.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, 'secret', 'password=secret')):
            with self.assertRaises(RuntimeError) as error:
                upgrade.run(['command'])
        self.assertNotIn('secret', str(error.exception))


if __name__ == '__main__':
    unittest.main()