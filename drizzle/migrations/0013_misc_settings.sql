-- Miscellaneous router settings: an optional command block the helper applies after firewall rules.
-- The on/off flag is exposed through a view so signed-in operators can see whether the extra
-- activation step runs, without reading router commands, logins or credentials.
ALTER TABLE public.helper_settings
  ADD COLUMN IF NOT EXISTS misc_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS misc_commands text NOT NULL DEFAULT '';

CREATE OR REPLACE VIEW public.router_settings_flags AS
  SELECT misc_enabled FROM public.helper_settings WHERE id = 1;

REVOKE ALL ON public.router_settings_flags FROM PUBLIC, anon;
GRANT SELECT ON public.router_settings_flags TO authenticated;
GRANT ALL ON public.router_settings_flags TO service_role;