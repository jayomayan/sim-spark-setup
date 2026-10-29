ALTER TABLE public.helper_settings ADD COLUMN router_logins_cipher text;
COMMENT ON COLUMN public.helper_settings.router_logins_cipher IS 'Encrypted ordered router login pairs; NULL falls back to the legacy single login.';
COMMENT ON COLUMN public.helper_settings.ur35_username IS 'DEPRECATED: compatibility for older helpers; replaced by router_logins_cipher.';
COMMENT ON COLUMN public.helper_settings.ur35_password_cipher IS 'DEPRECATED: compatibility for older helpers; replaced by router_logins_cipher.';