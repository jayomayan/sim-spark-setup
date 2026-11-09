import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('check_okta', Path(__file__).with_name('check-okta-login.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OktaLoginCheckTests(unittest.TestCase):
    def test_existing_unlinked_account_points_to_unverified_okta_email(self):
        result = ' '.join(module.findings(True, True, 1, True, False, False, 1, True))
        self.assertIn('NOT verified', result)

    def test_missing_email_scope_is_reported(self):
        result = ' '.join(module.findings(True, False, 1, True, False, False, 1, True))
        self.assertIn('"email" scope', result)

    def test_missing_local_account_is_reported(self):
        result = ' '.join(module.findings(True, True, 0, False, False, False, 0, True))
        self.assertIn('No local account uses this exact email', result)


if __name__ == '__main__':
    unittest.main()
