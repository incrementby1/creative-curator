-- Local reset migration: truncating creative_sessions is destructive by design.

truncate table public.creative_sessions;
alter table public.creative_sessions
  add column user_id uuid not null references auth.users(id) on delete cascade;
create index creative_sessions_user_id_idx on public.creative_sessions(user_id);

create table public.provider_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_slug text not null,
  ciphertext text not null,
  nonce text not null,
  key_version integer not null default 1,
  masked_suffix text not null,
  base_url text,
  connection_state text not null check (connection_state in ('connected', 'needs_attention')),
  tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider_slug)
);

create table public.user_ai_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  primary_provider_slug text,
  primary_model text,
  fallbacks jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.provider_credentials enable row level security;
alter table public.user_ai_settings enable row level security;
