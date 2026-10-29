-- Helper deployment: router credentials/templates the helper pulls from the console,
-- plus single-use enrolment codes that let a machine install itself.

create table public.helper_settings (
  id int primary key default 1 check (id = 1),
  agent_token_cipher text,
  ur35_username text not null default '',
  ur35_password_cipher text,
  ur35_firewall_path text not null default '/api/firewall/rules',
  ur35_ntp_path text not null default '/api/system/ntp',
  firewall_rules jsonb not null default '[]'::jsonb,
  ntp_settings jsonb not null default '{"enabled":true,"servers":["pool.ntp.org","time.google.com"],"timezone":"Asia/Manila"}'::jsonb,
  config_version integer not null default 1,
  updated_at timestamptz not null default now()
);

grant select, update, insert on public.helper_settings to authenticated;
grant all on public.helper_settings to service_role;
alter table public.helper_settings enable row level security;

create policy "admins manage helper settings" on public.helper_settings for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create table public.helper_enrollments (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index on public.helper_enrollments (expires_at);

grant select, insert, delete on public.helper_enrollments to authenticated;
grant all on public.helper_enrollments to service_role;
alter table public.helper_enrollments enable row level security;

create policy "admins manage enrollments" on public.helper_enrollments for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));