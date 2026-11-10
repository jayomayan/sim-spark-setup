CREATE TABLE public.site_connectivity_settings (
 id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
 targets jsonb NOT NULL DEFAULT '[{"port":80,"protocol":"http"},{"port":443,"protocol":"https"},{"port":8443,"protocol":"https"},{"port":8080,"protocol":"http"},{"port":8080,"protocol":"https"}]'::jsonb CHECK (jsonb_typeof(targets) = 'array'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.site_connectivity_settings TO authenticated;
GRANT ALL ON public.site_connectivity_settings TO service_role;
ALTER TABLE public.site_connectivity_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read connectivity targets" ON public.site_connectivity_settings FOR SELECT TO authenticated USING (public.is_member(auth.uid()));
CREATE POLICY "Admins insert connectivity targets" ON public.site_connectivity_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update connectivity targets" ON public.site_connectivity_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));