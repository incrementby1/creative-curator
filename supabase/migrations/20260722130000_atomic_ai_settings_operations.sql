-- Local-only atomic settings operations. Both functions serialize per user.

create or replace function public.delete_provider_credential_if_unreferenced(
  p_user_id uuid,
  p_provider_slug text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  if exists (
    select 1
    from public.user_ai_settings as settings
    where settings.user_id = p_user_id
      and (
        settings.primary_provider_slug = p_provider_slug
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(settings.fallbacks) as fallback
          where fallback ->> 'provider_slug' = p_provider_slug
        )
      )
  ) then
    return pg_catalog.jsonb_build_object('status', 'in_use');
  end if;

  delete from public.provider_credentials
  where user_id = p_user_id and provider_slug = p_provider_slug;
  get diagnostics deleted_count = row_count;

  return pg_catalog.jsonb_build_object(
    'status', case when deleted_count = 1 then 'deleted' else 'not_found' end
  );
end;
$$;

create or replace function public.save_user_ai_routing_if_connected(
  p_user_id uuid,
  p_primary_provider_slug text,
  p_primary_model text,
  p_fallbacks jsonb,
  p_expected_version integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version integer;
  next_version integer;
  normalized_fallbacks jsonb := coalesce(p_fallbacks, '[]'::jsonb);
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  if pg_catalog.jsonb_typeof(normalized_fallbacks) <> 'array'
     or (p_primary_provider_slug is null) <> (p_primary_model is null) then
    return pg_catalog.jsonb_build_object('status', 'invalid_settings');
  end if;

  if exists (
    with requested(provider_slug) as (
      select p_primary_provider_slug where p_primary_provider_slug is not null
      union
      select fallback ->> 'provider_slug'
      from pg_catalog.jsonb_array_elements(normalized_fallbacks) as fallback
    )
    select 1
    from requested
    left join public.provider_credentials as credential
      on credential.user_id = p_user_id
     and credential.provider_slug = requested.provider_slug
     and credential.connection_state = 'connected'
    where requested.provider_slug is null or credential.id is null
  ) then
    return pg_catalog.jsonb_build_object('status', 'provider_not_connected');
  end if;

  select settings.version
  into current_version
  from public.user_ai_settings as settings
  where settings.user_id = p_user_id
  for update;

  if not found then
    if p_expected_version <> 1 then
      return pg_catalog.jsonb_build_object('status', 'version_conflict');
    end if;
    next_version := 2;
    insert into public.user_ai_settings (
      user_id,
      primary_provider_slug,
      primary_model,
      fallbacks,
      version,
      updated_at
    ) values (
      p_user_id,
      p_primary_provider_slug,
      p_primary_model,
      normalized_fallbacks,
      next_version,
      pg_catalog.now()
    );
  else
    if current_version <> p_expected_version then
      return pg_catalog.jsonb_build_object('status', 'version_conflict');
    end if;
    next_version := current_version + 1;
    update public.user_ai_settings
    set primary_provider_slug = p_primary_provider_slug,
        primary_model = p_primary_model,
        fallbacks = normalized_fallbacks,
        version = next_version,
        updated_at = pg_catalog.now()
    where user_id = p_user_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'saved',
    'user_id', p_user_id,
    'primary_provider_slug', p_primary_provider_slug,
    'primary_model', p_primary_model,
    'fallbacks', normalized_fallbacks,
    'version', next_version
  );
end;
$$;

revoke all on function public.delete_provider_credential_if_unreferenced(uuid, text)
  from public, anon, authenticated;
revoke all on function public.save_user_ai_routing_if_connected(uuid, text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.delete_provider_credential_if_unreferenced(uuid, text)
  to service_role;
grant execute on function public.save_user_ai_routing_if_connected(uuid, text, text, jsonb, integer)
  to service_role;
