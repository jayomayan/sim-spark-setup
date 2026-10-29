CREATE TABLE public.console_connect_settings (
  integration text PRIMARY KEY CHECK (integration IN ('site_lookup', 'sim_activation')),
  token_url text NOT NULL DEFAULT '',
  api_url text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  username text NOT NULL DEFAULT '',
  password_cipher text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.console_connect_settings TO authenticated;
GRANT ALL ON public.console_connect_settings TO service_role;
ALTER TABLE public.console_connect_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage Console Connect settings" ON public.console_connect_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));