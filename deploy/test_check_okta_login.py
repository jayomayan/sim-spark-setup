import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('check_okta', Path(__file__).with_name('check-okta-login.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OktaLoginCheckTests(unittest.TestCase):
    def test_unlinked_local_account_does_not_establish_okta_claims(self):
        self.assertEqual(module.linking_status(True, True, 1, True, False, False), 'unlinked_claims_unknown')

    def test_linked_account_is_distinct_from_unknown_claims(self):
        self.assertEqual(module.linking_status(True, True, 1, True, False, True), 'linked')

    def test_missing_scope_prevents_ready_to_link_classification(self):
        self.assertEqual(module.linking_status(True, False, 1, True, False, False), 'prerequisite_missing')

    def test_missing_email_scope_is_reported(self):
        result = ' '.join(module.findings(True, False, 1, True, False, False, 1, True))
        self.assertIn('"email" scope', result)

    def test_missing_local_account_is_reported(self):
        result = ' '.join(module.findings(True, True, 0, False, False, False, 0, True))
        self.assertIn('No local account uses this exact email', result)


if __name__ == '__main__':
    unittest.main()
