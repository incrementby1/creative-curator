-- Local-only rollback. This removes ownership and BYOK settings schema.

drop function if exists public.save_user_ai_routing_if_connected(uuid, text, text, jsonb, integer);
drop function if exists public.delete_provider_credential_if_unreferenced(uuid, text);
drop table if exists public.user_ai_settings;
drop table if exists public.provider_credentials;
drop index if exists public.creative_sessions_user_id_idx;
alter table public.creative_sessions drop column if exists user_id;
