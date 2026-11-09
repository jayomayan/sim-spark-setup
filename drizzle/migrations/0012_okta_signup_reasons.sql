-- Same verified-Okta-only rule as before, but explain exactly why an Okta sign-in could not continue.
-- Auth only calls this hook when creating a NEW account, i.e. it could not link the Okta login
-- to an existing account (Okta email missing, not verified, or no account with that email).
CREATE OR REPLACE FUNCTION public.before_staff_user_created(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  is_okta boolean := coalesce(event->'user'->'app_metadata'->>'provider' = 'custom:app-oidc', false);
  has_email boolean := coalesce(event->'user'->>'email', '') <> '';
  verified boolean := coalesce(event->'user'->'user_metadata'->>'email_verified' = 'true', false);
BEGIN
  IF is_okta AND has_email AND verified THEN
    RETURN '{}'::jsonb;
  END IF;
  IF is_okta AND NOT has_email THEN
    RETURN jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message',
      'Okta did not share an email address for this sign-in. Ask your Okta administrator to allow the email scope for this app.'));
  END IF;
  IF is_okta THEN
    RETURN jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message',
      'Okta reports your email address as not verified, so it cannot be matched to your account. Ask your Okta administrator to verify your email in Okta, then try again.'));
  END IF;
  RETURN jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message',
    'Account registration is disabled. Staff sign in with Okta; partners need an admin invitation.'));
END $$;
REVOKE ALL ON FUNCTION public.before_staff_user_created(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.before_staff_user_created(jsonb) TO supabase_auth_admin;