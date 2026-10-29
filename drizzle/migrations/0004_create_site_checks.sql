CREATE TABLE public.site_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text,
  ip text NOT NULL,
  network text,
  ping jsonb,
  ports jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.site_checks TO authenticated;
GRANT ALL ON public.site_checks TO service_role;
ALTER TABLE public.site_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read site checks" ON public.site_checks FOR SELECT TO authenticated USING (is_member(auth.uid()));
CREATE POLICY "members save site checks" ON public.site_checks FOR INSERT TO authenticated WITH CHECK (is_member(auth.uid()) AND created_by = auth.uid());
CREATE INDEX site_checks_site_id_created_at ON public.site_checks (site_id, created_at DESC);
CREATE INDEX site_checks_ip_created_at ON public.site_checks (ip, created_at DESC);