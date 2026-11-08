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
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native_installer', Path(__file__).with_name('install-ubuntu.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerChecks(unittest.TestCase):
    def test_diagnose_does_not_prompt_or_install_or_read_secret_files(self):
        with patch('sys.argv', ['install-ubuntu.py', '--diagnose']), patch.object(installer, 'settings') as settings, patch.object(installer, 'preflight') as preflight, patch.object(installer, 'install') as install, patch.object(installer.Path, 'read_text') as read, patch.object(installer.Path, 'read_bytes') as binary:
            installer.main()
        for action in (settings, preflight, install, read, binary):
            action.assert_not_called()

    def test_unexpected_failure_identifies_class_without_leaking_message(self):
        try:
            raise TypeError('password=do-not-print-this')
        except TypeError as error:
            summary = installer.failure_summary(error)
        self.assertIn('TypeError', summary)
        self.assertNotIn('do-not-print-this', summary)

    def test_resume_routes_to_continuation_not_fresh_install(self):
        with patch('sys.argv', ['install-ubuntu.py', '--resume-after-auth']), patch.object(installer, 'resume_after_auth') as resume, patch.object(installer, 'preflight') as preflight, patch.object(installer, 'install') as install:
            installer.main()
        resume.assert_called_once()
        preflight.assert_not_called()
        install.assert_not_called()

    def test_restart_clean_routes_separately_from_install_and_resume(self):
        with patch('sys.argv', ['install-ubuntu.py', '--restart-clean']), patch.object(installer, 'restart_clean') as clean, patch.object(installer, 'preflight') as preflight, patch.object(installer, 'install') as install, patch.object(installer, 'resume_after_auth') as resume:
            installer.main()
        clean.assert_called_once()
        for action in (preflight, install, resume):
            action.assert_not_called()

    def test_restart_clean_refuses_combination_with_other_modes(self):
        for extra in ('--dry-run', '--resume-after-auth'):
            with patch('sys.argv', ['install-ubuntu.py', '--restart-clean', extra]), patch.object(installer, 'restart_clean') as clean:
                with self.assertRaises(RuntimeError):
                    installer.main()
            clean.assert_not_called()

    def test_restart_clean_requires_root_and_exact_confirmation(self):
        with patch.object(installer.os, 'geteuid', return_value=1000), patch.object(installer, 'ask') as ask:
            with self.assertRaises(RuntimeError):
                installer.restart_clean()
        ask.assert_not_called()
        with patch.object(installer.os, 'geteuid', return_value=0), patch.object(installer, 'ask', return_value='restart'), patch.object(installer, 'run') as command, patch.object(installer.shutil, 'move') as move:
            installer.restart_clean()
        command.assert_not_called()
        move.assert_not_called()

    def test_restart_clean_drops_only_installer_database_and_roles(self):
        calls = []

        def fake_run(args, **kwargs):
            calls.append(args)
            calls.append(kwargs.get('data') or '')
            if args[:3] == ['psql', '-X', '-At']:
                return '1\n'
            return ''

        with patch.object(installer.os, 'geteuid', return_value=0), patch.object(installer, 'ask', return_value='RESTART'), \
             patch.object(installer, 'run', side_effect=fake_run), patch.object(installer.shutil, 'which', return_value='/usr/bin/psql'), \
             patch.object(installer.shutil, 'move'), patch.object(installer.Path, 'exists', return_value=False), \
             patch.object(installer.Path, 'is_symlink', return_value=False), patch.object(installer.Path, 'mkdir'):
            installer.restart_clean()
        sql = ' '.join(str(call) for call in calls)
        self.assertIn("DROP DATABASE fieldops", sql)
        for role in ('fieldops_migration', 'fieldops_owner', 'supabase_auth_admin', 'authenticator', 'anon', 'authenticated', 'service_role'):
            self.assertIn('DROP ROLE IF EXISTS ' + role, sql)
        self.assertNotIn('DROP CLUSTER', sql)
        self.assertFalse(any(call and call[0] == 'pg_dropcluster' for call in calls))

    def test_resume_requires_root_before_any_secret_read(self):
        with patch.object(installer.os, 'geteuid', return_value=1000), patch.object(installer, 'resume_state') as read:
            with self.assertRaises(RuntimeError):
                installer.resume_after_auth()
        read.assert_not_called()

    def test_resume_preserves_auth_settings_and_refuses_later_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config, app, backend = (root / name for name in ('config', 'app', 'backend'))
            for path in (config, app, backend):
                path.mkdir()
            state = {'status': 'installing', 'ports': dict(installer.PORTS), 'website': 'ops.example.com', 'api': 'api.example.com'}
            (config / 'installation.json').write_text(json.dumps(state))
            auth = {'DATABASE_URL': 'postgresql://supabase_auth_admin:test@127.0.0.1:5432/fieldops', 'GOTRUE_SITE_URL': 'https://ops.example.com', 'API_EXTERNAL_URL': 'https://api.example.com/auth/v1', 'PORT': '9999', 'DB_NAMESPACE': 'auth', 'GOTRUE_JWT_SECRET': 'preserve-test-key'}
            installer.environment(config / 'auth.env', auth)
            original_exists = Path.exists
            with patch.object(installer, 'CONFIG', config), patch.object(installer, 'STATE', config / 'installation.json'), patch.object(installer, 'APP', app), patch.object(installer, 'BACKEND', backend), patch.object(Path, 'exists', lambda p: original_exists(p) if str(p).startswith(temp) else False), patch.object(Path, 'is_symlink', return_value=False):
                saved, loaded = installer.resume_state()
                self.assertEqual(loaded, auth)
                self.assertEqual(saved['ports']['database'], 5432)
                (config / 'rest.env').write_text('existing')
                with self.assertRaises(RuntimeError):
                    installer.resume_state()
                (config / 'rest.env').unlink()
                state['status'] = 'installed'
                (config / 'installation.json').write_text(json.dumps(state))
                with self.assertRaises(RuntimeError):
                    installer.resume_state()
            self.assertEqual((config / 'auth.env').read_text(), ''.join(k + '=' + installer.env_value(v) + '\n' for k, v in auth.items()))

    def account_context(self, *, shell='/usr/sbin/nologin', processes='', locked='!', groups=None):
        account = SimpleNamespace(pw_name='fieldops-web', pw_uid=991, pw_gid=991, pw_dir='/nonexistent', pw_shell=shell)
        group = SimpleNamespace(gr_name='fieldops-web', gr_gid=991, gr_mem=[])
        return account, group, ['fieldops-web:' + locked + ':0:0:0:0:0:0:', processes], groups or [group]

    def test_safe_existing_account_can_be_approved_without_useradd(self):
        identity = (991, 991, '/nonexistent', '/usr/sbin/nologin')
        with patch.dict(installer.APPROVED_ACCOUNTS, {}, clear=True), patch.object(installer, 'service_account', side_effect=[identity, None, None]), patch.object(installer, 'confirm', return_value=True):
            installer.check_service_accounts()
            with patch.object(installer, 'service_account', side_effect=[identity, None, None]), patch.object(installer, 'run', return_value='') as command:
                installer.create_service_accounts()
            self.assertEqual(command.call_count, 2)
            self.assertEqual([call.args[0][-1] for call in command.call_args_list], ['fieldops-auth', 'fieldops-rest'])

    def test_declining_reuse_makes_no_changes(self):
        with patch.dict(installer.APPROVED_ACCOUNTS, {}, clear=True), patch.object(installer, 'service_account', side_effect=[(991, 991, '/nonexistent', '/bin/false'), None, None]), patch.object(installer, 'confirm', return_value=False):
            with self.assertRaises(RuntimeError):
                installer.check_service_accounts()
            self.assertEqual(installer.APPROVED_ACCOUNTS, {})

    def test_active_interactive_unlocked_or_privileged_accounts_are_refused(self):
        for kwargs in ({}, {'shell': '/bin/bash'}, {'processes': ' 991\n'}, {'locked': 'password-hash'}, {'groups': [SimpleNamespace(gr_gid=27, gr_mem=['fieldops-web'])]}):
            account, group, output, groups = self.account_context(**kwargs)
            with patch.object(installer.pwd, 'getpwnam', return_value=account), patch.object(installer.pwd, 'getpwall', return_value=[account]), patch.object(installer.grp, 'getgrgid', return_value=group), patch.object(installer.grp, 'getgrall', return_value=groups), patch.object(installer, 'run', side_effect=output):
                if kwargs:
                    with self.assertRaises(RuntimeError):
                        installer.service_account('fieldops-web')
                else:
                    self.assertEqual(installer.service_account('fieldops-web'), (991, 991, '/nonexistent', '/usr/sbin/nologin'))

    def test_account_appearing_after_approval_is_not_taken_over(self):
        with patch.dict(installer.APPROVED_ACCOUNTS, {}, clear=True), patch.object(installer, 'service_account', return_value=(991, 991, '/nonexistent', '/bin/false')), patch.object(installer, 'run') as command:
            with self.assertRaises(RuntimeError):
                installer.create_service_accounts()
        command.assert_not_called()

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

    def test_systemd_environment_preserves_literal_password_and_private_permissions(self):
        value = 'spaces apostrophe\' double" $dollar `tick` \\slash'
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'settings.env'
            installer.environment(path, {'SAMPLE': value})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(installer.env_value('$dollar`tick`'), '"$dollar`tick`"')
            self.assertEqual(installer.env_value('quote"slash\\'), '"quote\\"slash\\\\"')
            self.assertEqual(path.read_text(), 'SAMPLE=' + installer.env_value(value) + '\n')
            with self.assertRaises(FileExistsError):
                installer.environment(path, {'SAMPLE': 'replacement'})
        with self.assertRaises(ValueError):
            installer.env_value('bad\nsetting')

    def test_dry_run_never_installs_and_prompts_hidden_secrets(self):
        answers = iter(['ops.example.com', 'api.example.com', 'admin@example.com', 'smtp.example.com', '', 'mailer', '', 'n', '', '', '', '', ''])
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

    def test_public_gateway_blocks_auth_administration_but_local_gateway_retains_it(self):
        with patch.object(installer, 'write') as write, patch.object(installer.Path, 'symlink_to'), patch.object(installer.Path, 'mkdir'):
            installer.configure_nginx({'website': 'ops.example.com', 'api': 'api.example.com'}, 'public-test-key', 'private-test-key')
        config = write.call_args_list[-1].args[1]
        local, public = config.split('server_name api.example.com;', 1)
        self.assertNotIn('location ^~ /auth/v1/admin', local)
        self.assertIn('location ^~ /auth/v1/admin { return 404; }', public)
        self.assertIn('proxy_hide_header Access-Control-Allow-Origin;', public)

    def test_existing_web_app_ports_are_skipped(self):
        listeners = 'LISTEN 0 128 127.0.0.1:3000 0.0.0.0:*\nLISTEN 0 128 [::]:5432 [::]:*'
        with patch('builtins.input', return_value=''):
            ports = installer.choose_ports(listeners)
        self.assertEqual(ports['web'], 3001)
        self.assertEqual(ports['database'], 5432)
        self.assertEqual(len(set(ports.values())), 5)

    def test_existing_nginx_is_allowed_but_other_web_server_is_not(self):
        nginx = 'LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1,fd=6))'
        with patch.object(installer, 'run', return_value=nginx), patch.object(installer.shutil, 'which', return_value=None):
            installer.check_shared_host({'website': 'ops.example.com', 'api': 'api.example.com'})
        with patch.object(installer, 'run', return_value=nginx.replace('nginx', 'apache2')), patch.object(installer.shutil, 'which', return_value=None):
            with self.assertRaises(RuntimeError):
                installer.check_shared_host({'website': 'ops.example.com', 'api': 'api.example.com'})

    def test_existing_hostname_cannot_be_taken_over(self):
        with patch.object(installer, 'run', side_effect=['', 'server_name ops.example.com;']), patch.object(installer.shutil, 'which', return_value='/usr/sbin/nginx'):
            with self.assertRaises(RuntimeError):
                installer.check_shared_host({'website': 'ops.example.com', 'api': 'api.example.com'})

    def test_database_commands_use_existing_postgres_port(self):
        with patch.object(installer.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as command, \
                patch.object(installer, 'runuser_path', return_value='/usr/sbin/runuser'):
            installer.run(['psql', '-d', 'fieldops'], user='postgres')
        self.assertEqual(command.call_args.args[0], ['/usr/sbin/runuser', '-u', 'postgres', '--', 'psql', '-p', '5432', '-d', 'fieldops'])

    def test_service_commands_find_runuser_despite_private_path(self):
        # The app's private PATH omits /usr/sbin; runuser must still be absolute.
        with patch.object(installer.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as command, \
                patch.object(installer, 'runuser_path', return_value='/sbin/runuser'):
            installer.run(['/opt/field-ops-backend/bin/bun', 'install'], user='fieldops-web', env={'PATH': installer.RUNTIME_PATH})
        self.assertEqual(command.call_args.args[0][0], '/sbin/runuser')
        self.assertNotIn('sbin', installer.RUNTIME_PATH)

    def test_temporary_migration_superuser_is_created_inside_cleanup(self):
        source = Path(installer.__file__).read_text()
        create = source.index("CREATE ROLE fieldops_migration")
        self.assertGreater(create, source.index("'install', '--frozen-lockfile'"))
        self.assertLess(source.index('try:', create), source.index("'db:migrate:standalone'"))

    def test_existing_postgres_check_is_read_only(self):
        with patch.object(installer.shutil, 'which', return_value='/usr/bin/tool'), patch.object(installer, 'run', side_effect=['', '120022\n']) as command:
            self.assertEqual(installer.check_existing_postgres(), '12')
        self.assertEqual([call.args[0][0] for call in command.call_args_list], ['pg_isready', 'psql'])
        self.assertNotIn('ALTER', command.call_args.kwargs['data'])
        self.assertNotIn('CREATE', command.call_args.kwargs['data'])

    def test_auth_tracking_table_targets_auth_without_public_create_permission(self):
        with patch.object(installer, 'run') as command:
            installer.prepare_auth_database()
        self.assertEqual(command.call_args.args[0][-2:], ['-d', 'fieldops'])
        sql = command.call_args.kwargs['data']
        self.assertIn('ALTER ROLE supabase_auth_admin IN DATABASE fieldops SET search_path = auth, public;', sql)
        self.assertIn('REVOKE CREATE ON SCHEMA public FROM PUBLIC;', sql)
        self.assertNotIn('GRANT CREATE', sql)
        self.assertNotIn('ALTER SYSTEM', sql)

    def test_postgres12_uuid_support_is_installed_before_auth_migrations(self):
        with patch.object(installer, 'run') as command:
            installer.prepare_auth_database()
        self.assertIn('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;', command.call_args.kwargs['data'])
        self.assertIn('GRANT USAGE ON SCHEMA public TO supabase_auth_admin,', command.call_args.kwargs['data'])

    def test_existing_database_or_roles_are_never_reused_or_overwritten(self):
        for result in ('120022\ndatabase_conflict\n', '120022\nrole_conflict\n'):
            with patch.object(installer.shutil, 'which', return_value='/usr/bin/tool'), patch.object(installer, 'run', side_effect=['', result]) as command:
                with self.assertRaises(RuntimeError):
                    installer.check_existing_postgres()
            self.assertEqual(command.call_count, 2)

    def test_missing_postgres_does_not_create_a_cluster(self):
        with patch.object(installer.shutil, 'which', return_value=None), patch.object(installer, 'run') as command:
            with self.assertRaises(RuntimeError):
                installer.check_existing_postgres()
        command.assert_not_called()

    def test_occupied_postgres_port_is_allowed_by_shared_host_check(self):
        listeners = 'LISTEN 0 128 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=1,fd=6))'
        with patch.object(installer, 'run', return_value=listeners), patch.object(installer.shutil, 'which', return_value=None):
            installer.check_shared_host({'website': 'ops.example.com', 'api': 'api.example.com'})

    def test_https_site_uses_chosen_ports_and_keeps_acme_renewal(self):
        values = {'website': 'ops.example.com', 'api': 'api.example.com'}
        with patch.dict(installer.PORTS, {'web': 3100, 'gateway': 8100, 'auth': 9100, 'rest': 3200}), patch.object(installer.Path, 'is_symlink', return_value=False), patch.object(installer.Path, 'write_text') as write, patch.object(installer, 'write') as exclusive:
            installer.configure_nginx(values, 'public-key', 'private-key', tls=True)
        exclusive.assert_not_called()
        config = write.call_args.args[0]
        self.assertIn('listen 127.0.0.1:8100;', config)
        self.assertIn('proxy_pass http://127.0.0.1:3100;', config)
        self.assertIn('proxy_pass http://127.0.0.1:9100/;', config)
        self.assertIn('proxy_pass http://127.0.0.1:3200/;', config)
        self.assertIn('listen 443 ssl;', config)
        self.assertIn('location ^~ /.well-known/acme-challenge/', config)


if __name__ == '__main__':
    unittest.main()