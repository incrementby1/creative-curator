-- Creates the table used by the Creative Curator demo to persist sessions.

create extension if not exists pgcrypto;

create table if not exists public.creative_sessions (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  description text not null,
  goal text null,
  status text not null default 'active',
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at_creative_sessions()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_creative_sessions_updated_at on public.creative_sessions;
create trigger trg_creative_sessions_updated_at
before update on public.creative_sessions
for each row
execute function public.set_updated_at_creative_sessions();

alter table public.creative_sessions enable row level security;

-- HACKATHON POLICY (NOT PROD SAFE): allows all reads/writes.
drop policy if exists creative_sessions_public_all on public.creative_sessions;
create policy creative_sessions_public_all
on public.creative_sessions
for all
using (true)
with check (true);
