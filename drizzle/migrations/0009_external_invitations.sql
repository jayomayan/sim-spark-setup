alter table public.profiles add column username text unique, add column phone text;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
create table public.account_security (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  must_change_password boolean not null default true,
  invited_by uuid not null,
  password_changed_at timestamptz
);
grant select on public.account_security to authenticated;
grant all on public.account_security to service_role;
alter table public.account_security enable row level security;
create policy "Read own password requirement" on public.account_security for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
and not exists (select 1 from public.account_security where user_id = _user_id and must_change_password) $$;
create or replace function public.is_member(_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id)
and not exists (select 1 from public.account_security where user_id = _user_id and must_change_password) $$;