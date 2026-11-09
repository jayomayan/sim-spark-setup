import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('okta_signup', Path(__file__).with_name('enable-okta-signup.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OktaSettingsTests(unittest.TestCase):
    def test_enables_only_with_staff_hook(self):
        result = module.updated_settings('GOTRUE_DISABLE_SIGNUP=true\nGOTRUE_JWT_SECRET=unchanged\n')
        self.assertIn('GOTRUE_DISABLE_SIGNUP=false\n', result)
        self.assertIn('GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true\n', result)
        self.assertIn('GOTRUE_HOOK_BEFORE_USER_CREATED_URI=pg-functions://postgres/public/before_staff_user_created\n', result)
        self.assertIn('GOTRUE_JWT_SECRET=unchanged\n', result)

    def test_refuses_other_hook(self):
        with self.assertRaises(ValueError):
            module.updated_settings('GOTRUE_HOOK_BEFORE_USER_CREATED_URI=https://existing.invalid\n')

    def test_idempotent(self):
        result = module.updated_settings('GOTRUE_DISABLE_SIGNUP=true\n')
        self.assertEqual(module.updated_settings(result), result)


if __name__ == '__main__':
    unittest.main()