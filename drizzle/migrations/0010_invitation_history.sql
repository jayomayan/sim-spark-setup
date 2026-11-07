create table public.invitation_history (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  admin_name text not null,
  username text not null,
  display_name text not null,
  email text,
  phone text not null,
  invited_user_id uuid,
  status text not null default 'started' check (status in ('started', 'created', 'failed', 'setup_failed')),
  email_status text not null check (email_status in ('not_requested', 'not_sent')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
grant select on public.invitation_history to authenticated;
grant all on public.invitation_history to service_role;
alter table public.invitation_history enable row level security;
create policy "Admins read invitation history" on public.invitation_history for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create index invitation_history_created_at_idx on public.invitation_history (created_at desc, id desc);
comment on table public.invitation_history is 'Admin invitation audit, retained independently of user deletion. No passwords or raw provider errors.';