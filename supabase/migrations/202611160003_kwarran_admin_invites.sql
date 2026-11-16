create table if not exists public.kwarran_admin_invites (
  id_invite uuid primary key default gen_random_uuid(),
  id_kwarran bigint not null references public.kwarran(id_kwarran) on delete cascade,
  invite_code text not null unique check (length(invite_code) between 20 and 64),
  created_by uuid references public.users(id_user) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references public.users(id_user) on delete set null,
  revoked_at timestamptz
);

create index if not exists kwarran_admin_invites_region_idx
  on public.kwarran_admin_invites(id_kwarran, created_at desc);
create index if not exists kwarran_admin_invites_status_idx
  on public.kwarran_admin_invites(used_at, revoked_at);

alter table public.kwarran_admin_invites enable row level security;
revoke all on public.kwarran_admin_invites from anon, authenticated;
grant select, insert, update, delete on public.kwarran_admin_invites to service_role;

comment on table public.kwarran_admin_invites is
  'Undangan sekali pakai untuk pendaftaran Admin Kwarran; kode hanya dikelola melalui Edge Function.';
