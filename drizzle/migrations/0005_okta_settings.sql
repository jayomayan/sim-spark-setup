CREATE TABLE public.okta_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  domain text NOT NULL DEFAULT '',
  client_id text NOT NULL DEFAULT '',
  client_secret_cipher text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE ON public.okta_settings TO authenticated;
GRANT ALL ON public.okta_settings TO service_role;
ALTER TABLE public.okta_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage Okta settings" ON public.okta_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));