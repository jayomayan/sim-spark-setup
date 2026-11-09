// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const db = new PGlite();
const id = '00000000-0000-0000-0000-000000000001';
beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE supabase_auth_admin;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb, email_confirmed_at timestamptz);
    CREATE TABLE auth.identities (user_id uuid, provider text, identity_data jsonb);
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, display_name text);
    CREATE TABLE public.user_roles (user_id uuid, role text, UNIQUE(user_id, role));
    CREATE TABLE public.account_security (user_id uuid, must_change_password boolean);
  `);
  await db.exec(readFileSync('drizzle/migrations/0011_okta_account_access.sql', 'utf8'));
  await db.exec(readFileSync('drizzle/migrations/0012_okta_signup_reasons.sql', 'utf8'));
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [id]);
});
afterAll(async () => { await db.close(); });

async function setup(verified = true, role?: string, pending = false) {
  await db.exec('TRUNCATE auth.users, auth.identities, public.profiles, public.user_roles, public.account_security');
  await db.query(`INSERT INTO auth.users VALUES ($1, 'staff@example.invalid', '{"name":"Staff"}', '{"provider":"email"}', now())`, [id]);
  await db.query(`INSERT INTO auth.identities VALUES ($1, 'custom:app-oidc', $2::jsonb)`, [id, JSON.stringify({ email: 'staff@example.invalid', email_verified: verified })]);
  if (role) await db.query('INSERT INTO public.user_roles VALUES ($1, $2)', [id, role]);
  if (pending) await db.query('INSERT INTO public.account_security VALUES ($1, true)', [id]);
}
async function provision() {
  return (await db.query<{ allowed: boolean }>('SELECT public.ensure_okta_access() AS allowed')).rows[0]?.allowed;
}

describe('verified Okta accounts', () => {
  it('saves new Okta users with operational access only', async () => {
    await setup();
    expect(await provision()).toBe(true);
    expect((await db.query('SELECT role FROM public.user_roles')).rows).toEqual([{ role: 'operator' }]);
    expect((await db.query('SELECT id, email FROM public.profiles')).rows).toEqual([{ id, email: 'staff@example.invalid' }]);
  });
  it('preserves the existing local account ID, profile and admin permission', async () => {
    await setup(true, 'admin');
    await db.query(`INSERT INTO public.profiles VALUES ($1, 'saved@example.invalid', 'Saved name')`, [id]);
    await provision(); await provision();
    expect((await db.query('SELECT * FROM public.profiles')).rows).toEqual([{ id, email: 'saved@example.invalid', display_name: 'Saved name' }]);
    expect((await db.query('SELECT * FROM public.user_roles')).rows).toEqual([{ user_id: id, role: 'admin' }]);
  });
  it('does not grant access from an unverified Okta email', async () => {
    await setup(false);
    expect(await provision()).toBe(false);
    expect((await db.query('SELECT * FROM public.user_roles')).rows).toEqual([]);
  });
  it('does not bypass an invited account password change', async () => {
    await setup(true, undefined, true);
    expect(await provision()).toBe(false);
    expect((await db.query('SELECT * FROM public.user_roles')).rows).toEqual([]);
  });
  it('does not grant roles to a password-only account', async () => {
    await setup(); await db.exec('TRUNCATE auth.identities');
    expect(await provision()).toBe(false);
  });
  it('permits only verified Okta registration, not spoofed password metadata', async () => {
    const call = async (provider: string, verified: boolean) => (await db.query<{ result: { error?: { http_code: number } } }>('SELECT public.before_staff_user_created($1::jsonb) AS result', [JSON.stringify({ user: { email: 'staff@example.invalid', app_metadata: { provider }, user_metadata: { email_verified: verified } } })])).rows[0]?.result;
    expect(await call('custom:app-oidc', true)).toEqual({});
    expect((await call('email', true))?.error?.http_code).toBe(403);
    expect((await call('custom:app-oidc', false))?.error?.http_code).toBe(403);
  });
  it('explains why an Okta sign-in could not be matched', async () => {
    const reason = async (user: object) => (await db.query<{ result: { error?: { message: string } } }>('SELECT public.before_staff_user_created($1::jsonb) AS result', [JSON.stringify({ user })])).rows[0]?.result.error?.message;
    expect(await reason({ email: 'staff@example.invalid', app_metadata: { provider: 'custom:app-oidc' }, user_metadata: {} })).toContain('not verified');
    expect(await reason({ email: '', app_metadata: { provider: 'custom:app-oidc' }, user_metadata: { email_verified: true } })).toContain('did not share an email');
    expect(await reason({ email: 'x@example.invalid', app_metadata: { provider: 'email' }, user_metadata: { email_verified: true } })).toContain('registration is disabled');
  });
});