-- Local-only rollback. This removes ownership and BYOK settings schema.

drop table if exists public.user_ai_settings;
drop table if exists public.provider_credentials;
drop index if exists public.creative_sessions_user_id_idx;
alter table public.creative_sessions drop column if exists user_id;
