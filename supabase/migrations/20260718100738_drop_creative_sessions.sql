-- Rollback helper if you accidentally applied the demo table to the wrong project.
-- Note: this does not remove entries from the Supabase migration history.

drop policy if exists creative_sessions_public_all on public.creative_sessions;
drop trigger if exists trg_creative_sessions_updated_at on public.creative_sessions;
drop function if exists public.set_updated_at_creative_sessions();
drop table if exists public.creative_sessions;
