#!/usr/bin/env python3
"""Read-only check of why an Okta login is not reaching an existing account. Prints no secrets."""
import os
import subprocess
from pathlib import Path

QUERY = r"""
SELECT
  (SELECT count(*) FROM auth.custom_oauth_providers WHERE identifier = 'custom:app-oidc' AND enabled),
  (SELECT count(*) FROM auth.custom_oauth_providers WHERE identifier = 'custom:app-oidc' AND position('email' in to_jsonb(scopes)::text) > 0),
  (SELECT count(*) FROM auth.users WHERE lower(email) = lower(:'email')),
  (SELECT count(*) FROM auth.users WHERE lower(email) = lower(:'email') AND email_confirmed_at IS NOT NULL),
  (SELECT count(*) FROM auth.users WHERE lower(email) = lower(:'email') AND is_sso_user),
  (SELECT count(*) FROM auth.identities i JOIN auth.users u ON u.id = i.user_id WHERE lower(u.email) = lower(:'email') AND i.provider = 'custom:app-oidc'),
  (SELECT count(*) FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id WHERE lower(u.email) = lower(:'email'));
"""


def findings(provider_on, email_scope, accounts, confirmed, sso, linked, roles, hook_on):
    """Turn counts into plain-language findings, most likely blocker first."""
    out = []
    if not provider_on:
        out.append('Okta sign-in is not registered or is turned off in the sign-in service.')
    elif not email_scope:
        out.append('The Okta provider does not request the "email" scope, so Okta sends no email. Re-register it with scopes openid, profile, email.')
    if accounts == 0:
        out.append('No local account uses this exact email. Okta will try to create a new account, which needs a verified Okta email.')
    else:
        if not confirmed:
            out.append('The local account email is not confirmed yet; confirm it (or reset the password) first.')
        if sso:
            out.append('The local account is marked as a single sign-on account and is skipped for automatic linking.')
        if linked:
            out.append('Okta is already linked to this account. If sign-in still fails, the problem is after linking (check roles).')
        elif confirmed and not sso and email_scope and provider_on:
            out.append('Not linked yet: Okta is sending this email as NOT verified. Ask the Okta administrator to verify the user email in Okta (email_verified must be true), then sign in again.')
        if linked and roles == 0:
            out.append('The account has no app role yet; it gets Non-Staff access on its next protected-page visit.')
    if not hook_on:
        out.append('The Okta registration hook is off; run deploy/enable-okta-signup.py if new Okta staff should be allowed.')
    return out or ['Everything checked looks correct.']


def main():
    if os.geteuid() != 0:
        raise ValueError('Run this command with sudo.')
    email = input('Email address used in Okta and the local account: ').strip()
    if '@' not in email or len(email) > 254 or any(c.isspace() for c in email):
        raise ValueError('Enter one valid email address.')
    env = Path('/etc/field-ops/auth.env')
    hook_on = env.is_file() and any(line.strip() == 'GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true' for line in env.read_text().splitlines())
    result = subprocess.run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-At', '-F', ',', '-v', 'ON_ERROR_STOP=1', '-v', 'email=' + email, '-d', 'fieldops'], input=QUERY, cwd='/tmp', capture_output=True, text=True)
    if result.returncode:
        raise ValueError('Could not read the sign-in tables; make sure the app is installed and upgraded.')
    counts = [int(value) for value in result.stdout.strip().split(',')]
    for line in findings(*(count > 0 for count in counts[:2]), counts[2], *(count > 0 for count in counts[3:6]), counts[6], hook_on):
        print('-', line)


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print('Stopped:', error)
        raise SystemExit(1)
