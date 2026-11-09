-- Only a server-verified Okta identity can grant automatic operational access.
CREATE OR REPLACE FUNCTION public.ensure_okta_access()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities i JOIN auth.users u ON u.id = i.user_id
    WHERE i.user_id = caller AND i.provider = 'custom:app-oidc'
      AND i.identity_data->>'email_verified' = 'true'
      AND lower(i.identity_data->>'email') = lower(u.email)
      AND u.email_confirmed_at IS NOT NULL
  ) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.account_security WHERE user_id = caller AND must_change_password) THEN RETURN false; END IF;
  INSERT INTO public.profiles (id, email, display_name)
    SELECT id, email, coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1)) FROM auth.users WHERE id = caller
    ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = caller) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (caller, 'operator') ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.ensure_okta_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_okta_access() TO authenticated;

-- Optional native Auth hook: permits verified Okta registration, not public password signup.
CREATE OR REPLACE FUNCTION public.before_staff_user_created(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF event->'user'->'app_metadata'->>'provider' = 'custom:app-oidc'
     AND event->'user'->'user_metadata'->>'email_verified' = 'true'
     AND coalesce(event->'user'->>'email', '') <> '' THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'New staff accounts must sign in with verified Okta. Partners require an admin invitation.'));
END $$;
REVOKE ALL ON FUNCTION public.before_staff_user_created(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.before_staff_user_created(jsonb) TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- Keep bootstrap behavior for local accounts, but never bootstrap an Okta administrator.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles)
     AND coalesce(new.raw_app_meta_data->>'provider', 'email') <> 'custom:app-oidc' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'admin');
  END IF;
  RETURN new;
END $$;