#!/usr/bin/env python3
"""Make Okta sign-in read the user's email verification from Okta's userinfo endpoint.

Okta's Authorization Code ID token is a "thin" token that omits email_verified.
The sign-in service's OIDC mode only reads the ID token, so every Okta email looks
unverified. This script re-registers the same provider (custom:app-oidc) in OAuth2
mode, where the sign-in service asks Okta's userinfo endpoint (server to server,
with the access token) and receives Okta's genuine email_verified value.

Nothing is faked: the claim still comes from Okta. Prints no secrets.
"""
import getpass
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

IDENTIFIER = 'custom:app-oidc'
SCOPES = ['openid', 'email', 'profile']


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def read_env(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        m = re.fullmatch(r'([A-Z][A-Z0-9_]*)="?((?:[^"\\]|\\["\\])*)"?', line.strip())
        if m:
            values[m[1]] = re.sub(r'\\(["\\])', r'\1', m[2])
    return values


def needs_switch(provider):
    """True when the registered provider still relies on the thin ID token only."""
    return not (provider.get('provider_type') == 'oauth2' and provider.get('userinfo_url'))


def endpoints_from_discovery(issuer, doc):
    """Return the Okta endpoints, refusing anything not on the issuer's own HTTPS host."""
    issuer = issuer.rstrip('/')
    if not issuer.startswith('https://'):
        raise ValueError('The registered Okta issuer is not an HTTPS address.')
    if str(doc.get('issuer', '')).rstrip('/') != issuer:
        raise ValueError('Okta discovery returned a different issuer; nothing was changed.')
    host = urllib.parse.urlsplit(issuer).hostname
    out = {}
    for key, name in (('authorization_endpoint', 'authorization_url'),
                      ('token_endpoint', 'token_url'),
                      ('userinfo_endpoint', 'userinfo_url')):
        url = str(doc.get(key, ''))
        parts = urllib.parse.urlsplit(url)
        if parts.scheme != 'https' or parts.hostname != host:
            raise ValueError(f'Okta discovery {key} is missing or not on {host}; nothing was changed.')
        out[name] = url
    if 'authorization_code' not in doc.get('grant_types_supported', ['authorization_code']):
        raise ValueError('This Okta issuer does not advertise Authorization Code sign-in.')
    return out


def oauth2_payload(client_id, secret, endpoints):
    return {
        'provider_type': 'oauth2', 'identifier': IDENTIFIER, 'name': 'Okta',
        'client_id': client_id, 'client_secret': secret, 'scopes': SCOPES,
        'pkce_enabled': True, 'enabled': True, **endpoints,
    }


def oidc_payload(client_id, secret, issuer, scopes):
    return {
        'provider_type': 'oidc', 'identifier': IDENTIFIER, 'name': 'Okta',
        'client_id': client_id, 'client_secret': secret, 'issuer': issuer,
        'scopes': scopes or SCOPES, 'enabled': True,
    }


def main():
    auth = read_env('/etc/field-ops/auth.env')
    app = read_env('/etc/field-ops-console.env')
    base = f"http://127.0.0.1:{int(auth['PORT'])}/admin/custom-providers"
    headers = {'Authorization': 'Bearer ' + app['SUPABASE_SERVICE_ROLE_KEY'], 'Content-Type': 'application/json'}

    def call(url, method='GET', body=None):
        req = urllib.request.Request(url, headers=headers, method=method,
                                     data=None if body is None else json.dumps(body).encode())
        with OPENER.open(req, timeout=20) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}

    try:
        current = call(f'{base}/{IDENTIFIER}')
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise ValueError('Okta sign-in is not registered yet; register custom:app-oidc first.')
        raise
    if not needs_switch(current):
        print('Already using Okta userinfo for email verification; nothing to change. Try Staff sign-in.')
        return
    issuer = str(current.get('issuer') or '').rstrip('/')
    client_id = str(current.get('client_id') or '')
    scopes = list(current.get('scopes') or SCOPES)
    if not issuer or not client_id:
        raise ValueError('The current Okta registration has no issuer or client ID; nothing was changed.')

    disc = urllib.request.Request(issuer + '/.well-known/openid-configuration', headers={'Accept': 'application/json'})
    with OPENER.open(disc, timeout=20) as response:
        endpoints = endpoints_from_discovery(issuer, json.load(response))

    with open('/dev/tty', 'r') as tin, open('/dev/tty', 'w') as tout:
        tout.write(f'Okta issuer: {issuer}\nOkta client ID: {client_id}\n'
                   f"Userinfo address: {endpoints['userinfo_url']}\n")
        secret = getpass.getpass('Okta client secret (same as now, not shown): ', stream=tout)
        tout.write('Type SWITCH to re-register Okta sign-in in userinfo mode: ')
        tout.flush()
        confirm = tin.readline().strip()
    if not secret:
        raise ValueError('The client secret is required; nothing was changed.')
    if confirm != 'SWITCH':
        raise ValueError('Not confirmed; nothing was changed.')

    call(f'{base}/{IDENTIFIER}', 'DELETE')
    try:
        call(base, 'POST', oauth2_payload(client_id, secret, endpoints))
    except Exception:
        try:
            call(base, 'POST', oidc_payload(client_id, secret, issuer, scopes))
            raise ValueError('The new registration was rejected; the previous Okta setup was restored.')
        except ValueError:
            raise
        except Exception:
            raise ValueError('The new registration failed AND the previous one could not be restored. '
                             'Re-register custom:app-oidc before staff sign in again.')
    finally:
        secret = ''
    saved = call(f'{base}/{IDENTIFIER}')
    if needs_switch(saved):
        raise ValueError('Re-registration could not be confirmed. Do not repeat yet; check the sign-in service.')
    print('Done. Okta sign-in now reads email_verified from Okta userinfo. Try Staff sign in with Okta again.')


if __name__ == '__main__':
    import os
    if os.geteuid() != 0:
        print('Stopped: run this command with sudo.')
        raise SystemExit(1)
    try:
        main()
    except urllib.error.HTTPError as error:
        print(f'Stopped: the sign-in service or Okta returned HTTP {error.code}.')
        raise SystemExit(1)
    except (ValueError, KeyError, OSError) as error:
        print('Stopped:', error if isinstance(error, ValueError) else 'could not read private settings or reach a service.')
        raise SystemExit(1)
