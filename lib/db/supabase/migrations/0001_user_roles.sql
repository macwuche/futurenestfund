-- Roles for Supabase Auth users. The API reads this (and the mirrored app_metadata.role) to authorize requests.
-- RLS is on with no policies, like every other table here: only the API's database connection reads or writes it.
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('applicant', 'admin', 'root')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

create index if not exists user_roles_role_idx on public.user_roles (role);
