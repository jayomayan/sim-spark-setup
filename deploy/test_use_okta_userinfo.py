import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('okta_userinfo', Path(__file__).with_name('use-okta-userinfo.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

ISSUER = 'https://example.okta.com'
DOC = {
    'issuer': ISSUER,
    'authorization_endpoint': ISSUER + '/oauth2/v1/authorize',
    'token_endpoint': ISSUER + '/oauth2/v1/token',
    'userinfo_endpoint': ISSUER + '/oauth2/v1/userinfo',
    'grant_types_supported': ['authorization_code', 'refresh_token'],
}


class OktaUserinfoTests(unittest.TestCase):
    def test_oidc_registration_needs_switch(self):
        self.assertTrue(module.needs_switch({'provider_type': 'oidc', 'issuer': ISSUER}))

    def test_oauth2_with_userinfo_is_left_alone(self):
        self.assertFalse(module.needs_switch({'provider_type': 'oauth2', 'userinfo_url': DOC['userinfo_endpoint']}))

    def test_discovery_endpoints_are_used(self):
        self.assertEqual(module.endpoints_from_discovery(ISSUER + '/', DOC)['userinfo_url'], ISSUER + '/oauth2/v1/userinfo')

    def test_endpoint_on_another_host_is_refused(self):
        doc = dict(DOC, userinfo_endpoint='https://evil.example/userinfo')
        with self.assertRaises(ValueError):
            module.endpoints_from_discovery(ISSUER, doc)

    def test_mismatched_issuer_is_refused(self):
        with self.assertRaises(ValueError):
            module.endpoints_from_discovery(ISSUER, dict(DOC, issuer='https://other.okta.com'))

    def test_payload_keeps_identifier_and_never_fakes_verification(self):
        payload = module.oauth2_payload('cid', 'sec', module.endpoints_from_discovery(ISSUER, DOC))
        self.assertEqual(payload['identifier'], 'custom:app-oidc')
        self.assertEqual(payload['provider_type'], 'oauth2')
        self.assertIn('email', payload['scopes'])
        self.assertNotIn('attribute_mapping', payload)


if __name__ == '__main__':
    unittest.main()
