create table public.database_connections (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  host text not null,
  port integer not null default 5432,
  database_name text not null default 'postgres',
  username text not null,
  password_cipher text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.database_connections TO authenticated;
GRANT ALL ON public.database_connections TO service_role;

ALTER TABLE public.database_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage database connections"
  ON public.database_connections
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public.database_connections IS 'Admin-editable connection profiles for alternate database servers; passwords stored encrypted, never returned to clients.';