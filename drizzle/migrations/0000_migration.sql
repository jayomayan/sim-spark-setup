create type public.app_role as enum ('admin', 'operator');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;

create or replace function public.is_member(_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id) $$;

create policy "own profile or admin" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "read own roles or admin" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- New users get a profile; the very first user becomes admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  if not exists (select 1 from public.user_roles) then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.devices (
  id bigint generated always as identity primary key,
  ip text not null unique,
  site_id text,
  name text,
  serial_number text unique,
  arm_version text, stm32_version text, web_version text, kernel_version text, mib_version text,
  last_log_pulled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.devices to authenticated;
grant all on public.devices to service_role;
alter table public.devices enable row level security;
create policy "members manage devices" on public.devices for all to authenticated
  using (public.is_member(auth.uid())) with check (public.is_member(auth.uid()));

create table public.device_logs (
  id bigint generated always as identity primary key,
  ip text not null,
  site_id text,
  date date not null,
  time time not null,
  event text,
  message text,
  created_at timestamptz not null default now(),
  unique (ip, date, time, message)
);
create index on public.device_logs (ip);
grant select, insert, delete on public.device_logs to authenticated;
grant all on public.device_logs to service_role;
alter table public.device_logs enable row level security;
create policy "members read logs" on public.device_logs for select to authenticated using (public.is_member(auth.uid()));

create table public.sim_activations (
  id uuid primary key default gen_random_uuid(),
  iccid text not null,
  ip text,
  status text not null default 'running',
  error text,
  simulated boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
grant select, insert, update on public.sim_activations to authenticated;
grant all on public.sim_activations to service_role;
alter table public.sim_activations enable row level security;
create policy "members manage activations" on public.sim_activations for all to authenticated
  using (public.is_member(auth.uid())) with check (public.is_member(auth.uid()));

create table public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  result jsonb,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index on public.agent_jobs (status, created_at);
grant select, insert on public.agent_jobs to authenticated;
grant all on public.agent_jobs to service_role;
alter table public.agent_jobs enable row level security;
create policy "members read jobs" on public.agent_jobs for select to authenticated using (public.is_member(auth.uid()));
create policy "members queue jobs" on public.agent_jobs for insert to authenticated
  with check (public.is_member(auth.uid()) and created_by = auth.uid() and status = 'queued');

create table public.agent_status (
  id int primary key default 1 check (id = 1),
  last_seen timestamptz,
  version text,
  hostname text
);
grant select on public.agent_status to authenticated;
grant all on public.agent_status to service_role;
alter table public.agent_status enable row level security;
create policy "members read agent status" on public.agent_status for select to authenticated using (public.is_member(auth.uid()));
insert into public.agent_status (id) values (1);