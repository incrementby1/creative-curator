-- Local-only owner-scoped spatial brand graph persistence.
create table public.brand_projects (
  id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null, title text not null, status text not null check (status in ('active','archived')),
  theme text not null check (theme in ('paper','graphite','project')),
  theme_override text check (theme_override is null or theme_override in ('paper','graphite','project')),
  version bigint not null check (version > 0), created_at timestamptz not null, updated_at timestamptz not null,
  primary key (user_id,id), unique (user_id,id), check (owner_id=user_id)
);
create table public.brand_nodes (
  id uuid not null, user_id uuid not null, project_id uuid not null, node_type text not null check(node_type in ('evidence','assumption','idea','decision','challenge','output')),
  title text not null, content text not null, state text not null check(state in ('working','approved','trash')), created_by text not null check(created_by in ('user','hermes','import')),
  provenance text, tags jsonb not null default '[]' check(jsonb_typeof(tags)='array'), version bigint not null check(version>0),
  created_at timestamptz not null, updated_at timestamptz not null, primary key(user_id,project_id,id),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);
create table public.brand_edges (
  id uuid not null, user_id uuid not null, project_id uuid not null, source_node_id uuid not null,
  target_node_id uuid not null, edge_type text not null check(edge_type in ('supports','contradicts','depends_on','inspires','supersedes')), label text, version bigint not null check(version>0),
  created_at timestamptz not null, updated_at timestamptz not null, primary key(user_id,project_id,id),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade,
  foreign key(user_id,project_id,source_node_id) references public.brand_nodes(user_id,project_id,id),
  foreign key(user_id,project_id,target_node_id) references public.brand_nodes(user_id,project_id,id),
  unique(user_id,project_id,source_node_id,target_node_id,edge_type), check(source_node_id<>target_node_id)
);
create table public.brand_node_revisions (
  id uuid not null, user_id uuid not null, project_id uuid not null, node_id uuid not null,
  node_version bigint not null check(node_version>0), title text not null, content text not null,
  node_type text not null check(node_type in ('evidence','assumption','idea','decision','challenge','output')),
  state text not null check(state in ('working','approved','trash')), created_by text not null check(created_by in ('user','hermes','import')),
  provenance text, tags jsonb not null check(jsonb_typeof(tags)='array'),
  created_at timestamptz not null, primary key(user_id,project_id,id),
  foreign key(user_id,project_id,node_id) references public.brand_nodes(user_id,project_id,id) on delete cascade
);
create table public.brand_layouts (
  user_id uuid not null, project_id uuid not null, positions jsonb not null default '{}' check(jsonb_typeof(positions)='object'),
  version bigint not null check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(user_id,project_id), foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);
create table public.brand_media (
  id uuid not null, user_id uuid not null, project_id uuid not null, owner_id uuid not null,
  storage_key text not null check(storage_key !~ '[/\\:]'), mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
  byte_length bigint not null check(byte_length between 1 and 5242880), sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  claim_hash text check(claim_hash is null or claim_hash ~ '^[0-9a-f]{64}$'), deletion_pending boolean not null default false,
  version bigint not null check(version>0), created_at timestamptz not null, updated_at timestamptz not null,
  primary key(user_id,project_id,id), unique(storage_key), check(owner_id=user_id),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);
create table public.brand_annotations (
  id uuid not null, user_id uuid not null, project_id uuid not null, owner_id uuid not null,
  annotation_type text not null check(annotation_type in ('freehand','media')), path_points jsonb not null default '[]' check(jsonb_typeof(path_points)='array'),
  color text, media_id uuid, version bigint not null check(version>0), created_at timestamptz not null, updated_at timestamptz not null,
  primary key(user_id,project_id,id), check(owner_id=user_id),
  check((annotation_type='freehand' and media_id is null and color is not null) or
        (annotation_type='media' and media_id is not null and color is null)),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade,
  foreign key(user_id,project_id,media_id) references public.brand_media(user_id,project_id,id)
);
create table public.brand_annotation_sets (
  user_id uuid not null, project_id uuid not null, version bigint not null check(version>=0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(user_id,project_id), foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);
create table public.brand_user_preferences (
  user_id uuid not null references auth.users(id) on delete cascade, theme text not null check(theme in ('paper','graphite','project')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(user_id)
);
create table public.brand_proposals (
  id uuid not null, user_id uuid not null, project_id uuid not null, title text not null, rationale text not null,
  target_node_ids jsonb not null check(jsonb_typeof(target_node_ids)='array'), creation_source text not null check(creation_source in ('user','hermes','import')),
  canonical_hash text not null check(canonical_hash ~ '^[0-9a-f]{64}$'),
  dependency_node_versions jsonb not null check(jsonb_typeof(dependency_node_versions)='object'),
  dependency_edge_versions jsonb not null check(jsonb_typeof(dependency_edge_versions)='object'),
  state text not null check(state in ('pending','accepted','rejected')),
  version bigint not null check(version>0), created_at timestamptz not null, updated_at timestamptz not null,
  primary key(user_id,project_id,id), foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);
create table public.brand_analysis_cache (
  user_id uuid not null, project_id uuid not null, cache_key text not null, analysis jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(user_id,project_id,cache_key),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);
create table public.brand_analysis_requests (
  user_id uuid not null, project_id uuid not null, idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
  claim_hash text check(claim_hash is null or claim_hash ~ '^[0-9a-f]{64}$'),
  status text not null check(status in ('pending','completed')), result jsonb, lease_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(user_id,project_id,idempotency_key),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade,
  check((status='pending' and claim_hash is not null and result is null and lease_expires_at is not null)
     or (status='completed' and claim_hash is null and jsonb_typeof(result)='object' and lease_expires_at is null))
);
create table public.brand_challenge_resolutions (
  id uuid not null, user_id uuid not null, project_id uuid not null, challenge_id uuid not null,
  resolution text not null, state text not null check(state in ('resolved','deferred','overridden')),
  resolved_by uuid not null, version bigint not null check(version>0),
  created_at timestamptz not null, updated_at timestamptz not null,
  primary key(user_id,project_id,id), unique(user_id,project_id,challenge_id),
  foreign key(user_id,project_id,challenge_id) references public.brand_nodes(user_id,project_id,id) on delete cascade
);
create table public.brand_blueprint_snapshots (
  id uuid not null, user_id uuid not null, project_id uuid not null, name text not null,
  node_ids jsonb not null, edge_ids jsonb not null, version bigint not null check(version>0), created_at timestamptz not null,
  project_version bigint not null check(project_version>0), sequence bigint not null check(sequence>0),
  canonical_json text not null, readiness_warnings jsonb not null, unresolved_assumption_ids jsonb not null,
  primary key(user_id,project_id,id), unique(user_id,project_id,project_version), unique(user_id,project_id,sequence),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);

alter table public.brand_projects enable row level security;
alter table public.brand_nodes enable row level security;
alter table public.brand_edges enable row level security;
alter table public.brand_node_revisions enable row level security;
alter table public.brand_layouts enable row level security;
alter table public.brand_media enable row level security;
alter table public.brand_annotations enable row level security;
alter table public.brand_annotation_sets enable row level security;
alter table public.brand_user_preferences enable row level security;
alter table public.brand_proposals enable row level security;
alter table public.brand_analysis_cache enable row level security;
alter table public.brand_analysis_requests enable row level security;
alter table public.brand_challenge_resolutions enable row level security;
alter table public.brand_blueprint_snapshots enable row level security;

create index brand_projects_owner_status_idx on public.brand_projects(user_id,status,updated_at desc);
create index brand_nodes_owner_project_state_idx on public.brand_nodes(user_id,project_id,state);
create index brand_edges_owner_project_idx on public.brand_edges(user_id,project_id);
create index brand_proposals_owner_project_state_idx on public.brand_proposals(user_id,project_id,state);
create index brand_challenge_resolutions_owner_challenge_idx on public.brand_challenge_resolutions(user_id,project_id,challenge_id,created_at);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('brand-canvas-media', 'brand-canvas-media', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.lock_brand_project(p_user_id uuid,p_project_id uuid)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_project_id::text,0));
end $$;

create or replace function public.create_brand_node(p_user_id uuid,p_project_id uuid,p_record jsonb,p_expected_project_version bigint)
returns setof public.brand_nodes language plpgsql security definer set search_path='' as $$ declare x public.brand_nodes; begin
  perform public.lock_brand_project(p_user_id,p_project_id);
  if not exists(select 1 from public.brand_projects where user_id=p_user_id and id=p_project_id) then raise exception 'project_missing' using errcode='P2100'; end if;
  x := jsonb_populate_record(null::public.brand_nodes,p_record);
  if x.user_id<>p_user_id or x.project_id<>p_project_id or x.version<>1 then raise exception 'invalid_scope' using errcode='23514'; end if;
  update public.brand_projects set version=version+1,updated_at=now() where user_id=p_user_id and id=p_project_id and version=p_expected_project_version;
  if not found then raise exception 'version_conflict' using errcode='40001'; end if;
  return query insert into public.brand_nodes select x.* returning *;
end $$;
create or replace function public.update_brand_node(p_user_id uuid,p_project_id uuid,p_record jsonb,p_revision jsonb,p_expected_node_version bigint,p_expected_project_version bigint)
returns setof public.brand_nodes language plpgsql security definer set search_path='' as $$ declare x public.brand_nodes; r public.brand_node_revisions; prior public.brand_nodes; changed public.brand_nodes; begin
  perform public.lock_brand_project(p_user_id,p_project_id);
  x := jsonb_populate_record(null::public.brand_nodes,p_record); r := jsonb_populate_record(null::public.brand_node_revisions,p_revision);
  if x.user_id<>p_user_id or x.project_id<>p_project_id or x.version<>p_expected_node_version+1 or r.user_id<>p_user_id or r.project_id<>p_project_id or r.node_id<>x.id or r.node_version<>p_expected_node_version then raise exception 'invalid_scope' using errcode='23514'; end if;
  select * into prior from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=x.id for update;
  if prior.id is null then raise exception 'node_missing' using errcode='P2005'; end if;
  if prior.version<>p_expected_node_version then raise exception 'version_conflict' using errcode='40001'; end if;
  if r.title<>prior.title or r.content<>prior.content or r.node_type<>prior.node_type or r.state<>prior.state or r.created_by<>prior.created_by or r.provenance is distinct from prior.provenance or r.tags<>prior.tags or r.created_at<prior.updated_at then raise exception 'invalid_revision' using errcode='P2001'; end if;
  if x.state='trash' and exists(select 1 from public.brand_edges where user_id=p_user_id and project_id=p_project_id and (source_node_id=x.id or target_node_id=x.id)) then raise exception 'incident_edge' using errcode='P2002'; end if;
  update public.brand_nodes n set node_type=x.node_type,title=x.title,content=x.content,state=x.state,provenance=x.provenance,tags=x.tags,version=x.version,updated_at=x.updated_at where n.user_id=p_user_id and n.project_id=p_project_id and n.id=x.id and n.version=p_expected_node_version returning n.* into changed;
  if changed.id is null then raise exception 'version_conflict' using errcode='40001'; end if;
  insert into public.brand_node_revisions select r.*;
  update public.brand_projects set version=version+1,updated_at=now() where user_id=p_user_id and id=p_project_id and version=p_expected_project_version;
  if not found then raise exception 'version_conflict' using errcode='40001'; end if;
  return next changed;
end $$;
create or replace function public.delete_brand_node(p_user_id uuid,p_project_id uuid,p_node_id uuid,p_expected_node_version bigint,p_expected_project_version bigint)
returns void language plpgsql security definer set search_path='' as $$ declare v bigint; begin perform public.lock_brand_project(p_user_id,p_project_id); select version into v from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=p_node_id for update; if v is null then raise exception 'node_missing' using errcode='P2005'; end if; if v<>p_expected_node_version then raise exception 'version_conflict' using errcode='40001'; end if; if exists(select 1 from public.brand_edges where user_id=p_user_id and project_id=p_project_id and (source_node_id=p_node_id or target_node_id=p_node_id)) then raise exception 'incident_edge' using errcode='P2002'; end if; delete from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=p_node_id; update public.brand_projects set version=version+1,updated_at=now() where user_id=p_user_id and id=p_project_id and version=p_expected_project_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; end $$;
create or replace function public.create_brand_edge(p_user_id uuid,p_project_id uuid,p_record jsonb,p_expected_project_version bigint) returns setof public.brand_edges language plpgsql security definer set search_path='' as $$ declare x public.brand_edges; begin perform public.lock_brand_project(p_user_id,p_project_id); if not exists(select 1 from public.brand_projects where user_id=p_user_id and id=p_project_id) then raise exception 'project_missing' using errcode='P2100'; end if; x:=jsonb_populate_record(null::public.brand_edges,p_record); if x.user_id<>p_user_id or x.project_id<>p_project_id or x.version<>1 then raise exception 'invalid_scope' using errcode='P2001'; end if; if not exists(select 1 from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=x.source_node_id and state<>'trash') or not exists(select 1 from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=x.target_node_id and state<>'trash') then raise exception 'invalid_edge_endpoint' using errcode='P2003'; end if; update public.brand_projects set version=version+1 where user_id=p_user_id and id=p_project_id and version=p_expected_project_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; return query insert into public.brand_edges select x.* returning *; end $$;
create or replace function public.update_brand_edge(p_user_id uuid,p_project_id uuid,p_record jsonb,p_expected_edge_version bigint,p_expected_project_version bigint) returns setof public.brand_edges language plpgsql security definer set search_path='' as $$ declare x public.brand_edges; current_edge public.brand_edges; changed public.brand_edges; begin perform public.lock_brand_project(p_user_id,p_project_id); x:=jsonb_populate_record(null::public.brand_edges,p_record); select * into current_edge from public.brand_edges where user_id=p_user_id and project_id=p_project_id and id=x.id for update; if current_edge.id is null then raise exception 'edge_missing' using errcode='P2005'; end if; if current_edge.version<>p_expected_edge_version then raise exception 'version_conflict' using errcode='40001'; end if; if x.user_id<>p_user_id or x.project_id<>p_project_id or x.version<>p_expected_edge_version+1 then raise exception 'invalid_scope' using errcode='P2001'; end if; if not exists(select 1 from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=x.source_node_id and state<>'trash') or not exists(select 1 from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=x.target_node_id and state<>'trash') then raise exception 'invalid_edge_endpoint' using errcode='P2003'; end if; update public.brand_edges e set source_node_id=x.source_node_id,target_node_id=x.target_node_id,edge_type=x.edge_type,label=x.label,version=x.version,updated_at=x.updated_at where e.user_id=p_user_id and e.project_id=p_project_id and e.id=x.id returning e.* into changed; update public.brand_projects set version=version+1 where user_id=p_user_id and id=p_project_id and version=p_expected_project_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; return next changed; end $$;
create or replace function public.delete_brand_edge(p_user_id uuid,p_project_id uuid,p_edge_id uuid,p_expected_edge_version bigint,p_expected_project_version bigint) returns void language plpgsql security definer set search_path='' as $$ declare v bigint; begin perform public.lock_brand_project(p_user_id,p_project_id); select version into v from public.brand_edges where user_id=p_user_id and project_id=p_project_id and id=p_edge_id for update; if v is null then raise exception 'edge_missing' using errcode='P2005'; end if; if v<>p_expected_edge_version then raise exception 'version_conflict' using errcode='40001'; end if; delete from public.brand_edges where user_id=p_user_id and project_id=p_project_id and id=p_edge_id; update public.brand_projects set version=version+1 where user_id=p_user_id and id=p_project_id and version=p_expected_project_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; end $$;
create or replace function public.create_brand_edge_direct(p_user_id uuid,p_project_id uuid,p_record jsonb) returns setof public.brand_edges language plpgsql security definer set search_path='' as $$ declare x public.brand_edges; begin perform public.lock_brand_project(p_user_id,p_project_id); if not exists(select 1 from public.brand_projects where user_id=p_user_id and id=p_project_id) then raise exception 'project_missing' using errcode='P2100'; end if; x:=jsonb_populate_record(null::public.brand_edges,p_record); if x.user_id<>p_user_id or x.project_id<>p_project_id or x.version<>1 then raise exception 'invalid_scope' using errcode='P2001'; end if; if not exists(select 1 from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=x.source_node_id and state<>'trash') or not exists(select 1 from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=x.target_node_id and state<>'trash') then raise exception 'invalid_edge_endpoint' using errcode='P2003'; end if; return query insert into public.brand_edges select x.* returning *; end $$;
create or replace function public.update_brand_edge_direct(p_user_id uuid,p_project_id uuid,p_record jsonb,p_expected_edge_version bigint) returns setof public.brand_edges language plpgsql security definer set search_path='' as $$ declare x public.brand_edges; current_edge public.brand_edges; begin perform public.lock_brand_project(p_user_id,p_project_id); if not exists(select 1 from public.brand_projects where user_id=p_user_id and id=p_project_id) then raise exception 'project_missing' using errcode='P2100'; end if; x:=jsonb_populate_record(null::public.brand_edges,p_record); select * into current_edge from public.brand_edges where user_id=p_user_id and project_id=p_project_id and id=x.id for update; if current_edge.id is null then raise exception 'edge_missing' using errcode='P2005'; end if; if current_edge.version<>p_expected_edge_version then raise exception 'version_conflict' using errcode='40001'; end if; if x.user_id<>p_user_id or x.project_id<>p_project_id or x.version<>p_expected_edge_version+1 then raise exception 'invalid_scope' using errcode='P2001'; end if; if not exists(select 1 from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=x.source_node_id and state<>'trash') or not exists(select 1 from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=x.target_node_id and state<>'trash') then raise exception 'invalid_edge_endpoint' using errcode='P2003'; end if; return query update public.brand_edges set source_node_id=x.source_node_id,target_node_id=x.target_node_id,edge_type=x.edge_type,label=x.label,version=x.version,updated_at=x.updated_at where user_id=p_user_id and project_id=p_project_id and id=x.id returning *; end $$;
create or replace function public.replace_brand_annotations(p_user_id uuid,p_project_id uuid,p_annotations jsonb,p_expected_version bigint) returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint; bad bigint; begin
  perform public.lock_brand_project(p_user_id,p_project_id);
  insert into public.brand_annotation_sets(user_id,project_id,version) values(p_user_id,p_project_id,0) on conflict do nothing;
  select version into v from public.brand_annotation_sets where user_id=p_user_id and project_id=p_project_id for update;
  if v<>p_expected_version then raise exception 'version_conflict' using errcode='40001'; end if;
  select count(*) into bad from jsonb_populate_recordset(null::public.brand_annotations,p_annotations) a
    left join public.brand_annotations old on old.user_id=p_user_id and old.project_id=p_project_id and old.id=a.id
    left join public.brand_media m on m.user_id=p_user_id and m.project_id=p_project_id and m.id=a.media_id and not m.deletion_pending
    where a.user_id<>p_user_id or a.project_id<>p_project_id or a.owner_id<>p_user_id
       or (old.id is null and a.version<>1)
       or (old.id is not null and not (
          (a.version=old.version and a.annotation_type=old.annotation_type and a.path_points=old.path_points
           and a.color is not distinct from old.color and a.media_id is not distinct from old.media_id
           and a.created_at=old.created_at and a.updated_at=old.updated_at)
          or (a.version=old.version+1 and a.created_at=old.created_at and a.updated_at>old.updated_at)))
       or (a.annotation_type='media' and m.id is null)
       or (a.annotation_type='freehand' and (jsonb_array_length(a.path_points)<2 or a.media_id is not null))
       or exists(select 1 from jsonb_array_elements(a.path_points) point where case when jsonb_typeof(point)='array' then jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number' or jsonb_typeof(point->1)<>'number' else true end)
       or (a.annotation_type='media' and (a.path_points<>'[]'::jsonb or a.color is not null or a.media_id is null));
  if bad<>0 then raise exception 'invalid_annotation' using errcode='23514'; end if;
  delete from public.brand_annotations where user_id=p_user_id and project_id=p_project_id;
  insert into public.brand_annotations select * from jsonb_populate_recordset(null::public.brand_annotations,p_annotations);
  update public.brand_media set claim_hash = null where user_id=p_user_id and project_id=p_project_id
    and id in (select media_id from public.brand_annotations where user_id=p_user_id and project_id=p_project_id and media_id is not null);
  update public.brand_annotation_sets set version=p_expected_version+1,updated_at=now() where user_id=p_user_id and project_id=p_project_id;
  return p_expected_version+1;
end $$;
create or replace function public.get_brand_annotations(p_user_id uuid,p_project_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ declare v bigint; items jsonb; begin perform public.lock_brand_project(p_user_id,p_project_id); select version into v from public.brand_annotation_sets where user_id=p_user_id and project_id=p_project_id; select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into items from public.brand_annotations a where a.user_id=p_user_id and a.project_id=p_project_id; return jsonb_build_object('user_id',p_user_id,'project_id',p_project_id,'version',coalesce(v,0),'annotations',items); end $$;
create or replace function public.accept_brand_proposal(p_user_id uuid,p_project_id uuid,p_proposal jsonb,p_nodes jsonb,p_edges jsonb,p_expected_proposal_version bigint,p_expected_project_version bigint)
returns setof public.brand_proposals language plpgsql security definer set search_path='' as $$
declare candidate public.brand_proposals; current_proposal public.brand_proposals; bad bigint; begin
  perform public.lock_brand_project(p_user_id,p_project_id);
  candidate := jsonb_populate_record(null::public.brand_proposals,p_proposal);
  if candidate.user_id<>p_user_id or candidate.project_id<>p_project_id or candidate.version<>p_expected_proposal_version+1 or candidate.state<>'accepted' then raise exception 'invalid_scope' using errcode='23514'; end if;
  perform 1 from public.brand_projects where user_id=p_user_id and id=p_project_id and version=p_expected_project_version for update;
  if not found then raise exception 'version_conflict' using errcode='40001'; end if;
  select * into current_proposal from public.brand_proposals where user_id=p_user_id and project_id=p_project_id and id=candidate.id and version=p_expected_proposal_version and state='pending' for update;
  if current_proposal.id is null then raise exception 'version_conflict' using errcode='40001'; end if;
  if current_proposal.title is distinct from candidate.title
     or current_proposal.rationale is distinct from candidate.rationale
     or current_proposal.target_node_ids is distinct from candidate.target_node_ids
     or current_proposal.canonical_hash is distinct from candidate.canonical_hash
     or current_proposal.dependency_node_versions is distinct from candidate.dependency_node_versions
     or current_proposal.dependency_edge_versions is distinct from candidate.dependency_edge_versions
     or current_proposal.creation_source is distinct from candidate.creation_source
     or current_proposal.created_at is distinct from candidate.created_at
     or current_proposal.project_id is distinct from candidate.project_id
     or current_proposal.id is distinct from candidate.id then
    raise exception 'invalid_proposal' using errcode='23514';
  end if;
  if exists(
    select 1 from public.brand_nodes n right join jsonb_each_text(current_proposal.dependency_node_versions) dependency
      on n.user_id=p_user_id and n.project_id=p_project_id
      and n.id=dependency.key::uuid and n.version=dependency.value::bigint and n.state<>'trash'
    where n.id is null
  ) or exists(
    select 1 from public.brand_edges e right join jsonb_each_text(current_proposal.dependency_edge_versions) dependency
      on e.user_id=p_user_id and e.project_id=p_project_id
      and e.id=dependency.key::uuid and e.version=dependency.value::bigint
    where e.id is null
  ) then raise exception 'version_conflict' using errcode='40001'; end if;
  select count(*) into bad from jsonb_populate_recordset(null::public.brand_nodes,p_nodes) n where n.user_id<>p_user_id or n.project_id<>p_project_id or n.version<>1 or n.state='trash';
  if bad<>0 then raise exception 'invalid_node' using errcode='23514'; end if;
  insert into public.brand_nodes select * from jsonb_populate_recordset(null::public.brand_nodes,p_nodes);
  select count(*) into bad from jsonb_populate_recordset(null::public.brand_edges,p_edges) e
    left join public.brand_nodes s on s.user_id=p_user_id and s.project_id=p_project_id and s.id=e.source_node_id and s.state<>'trash'
    left join public.brand_nodes t on t.user_id=p_user_id and t.project_id=p_project_id and t.id=e.target_node_id and t.state<>'trash'
    where e.user_id<>p_user_id or e.project_id<>p_project_id or e.version<>1 or s.id is null or t.id is null;
  if bad<>0 then raise exception 'invalid_edge' using errcode='23514'; end if;
  insert into public.brand_edges select * from jsonb_populate_recordset(null::public.brand_edges,p_edges);
  update public.brand_proposals set title=candidate.title,rationale=candidate.rationale,target_node_ids=candidate.target_node_ids,
    canonical_hash=candidate.canonical_hash,dependency_node_versions=candidate.dependency_node_versions,
    dependency_edge_versions=candidate.dependency_edge_versions,
    creation_source=candidate.creation_source,state=candidate.state,version=candidate.version,updated_at=candidate.updated_at
    where user_id=p_user_id and project_id=p_project_id and id=candidate.id;
  update public.brand_projects set version=version+1,updated_at=now() where user_id=p_user_id and id=p_project_id and version=p_expected_project_version;
  if not found then raise exception 'version_conflict' using errcode='40001'; end if;
  return query select * from public.brand_proposals where user_id=p_user_id and project_id=p_project_id and id=candidate.id;
end $$;
create or replace function public.claim_brand_analysis_request(p_user_id uuid,p_project_id uuid,p_idempotency_key text,p_request_fingerprint text,p_claim_hash text,p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_request public.brand_analysis_requests; begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_project_id::text||':'||p_idempotency_key,0));
  if not exists(select 1 from public.brand_projects where user_id=p_user_id and id=p_project_id) then raise exception 'project_missing' using errcode='P2100'; end if;
  select * into current_request from public.brand_analysis_requests where user_id=p_user_id and project_id=p_project_id and idempotency_key=p_idempotency_key for update;
  if current_request.idempotency_key is null then
    insert into public.brand_analysis_requests(user_id,project_id,idempotency_key,request_fingerprint,claim_hash,status,lease_expires_at)
      values(p_user_id,p_project_id,p_idempotency_key,p_request_fingerprint,p_claim_hash,'pending',
        now()+make_interval(secs=>least(300,greatest(1,p_lease_seconds))));
    return jsonb_build_object('status','claimed');
  end if;
  if current_request.request_fingerprint<>p_request_fingerprint then raise exception 'idempotency_mismatch' using errcode='P2201'; end if;
  if current_request.status='pending' and current_request.lease_expires_at<=now() then
    update public.brand_analysis_requests set claim_hash=p_claim_hash,
      lease_expires_at = now() + make_interval(secs=>least(300,greatest(1,p_lease_seconds))),updated_at=now()
      where user_id=p_user_id and project_id=p_project_id and idempotency_key=p_idempotency_key;
    return jsonb_build_object('status','claimed');
  end if;
  if current_request.status='pending' then raise exception 'analysis_in_progress' using errcode='P2202'; end if;
  return jsonb_build_object('status','completed','result',current_request.result);
end $$;
create or replace function public.complete_brand_analysis_request(p_user_id uuid,p_project_id uuid,p_idempotency_key text,p_claim_hash text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_project_id::text||':'||p_idempotency_key,0));
  update public.brand_analysis_requests set status='completed',claim_hash=null,result=p_result,lease_expires_at=null,updated_at=now()
    where user_id=p_user_id and project_id=p_project_id and idempotency_key=p_idempotency_key
      and status='pending' and claim_hash=p_claim_hash;
  if not found then raise exception 'analysis_claim_lost' using errcode='P2203'; end if;
  return jsonb_build_object('completed',true,'user_id',p_user_id,'project_id',p_project_id,
    'idempotency_key',p_idempotency_key,'result',p_result);
end $$;
create or replace function public.abandon_brand_analysis_request(p_user_id uuid,p_project_id uuid,p_idempotency_key text,p_claim_hash text)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_project_id::text||':'||p_idempotency_key,0));
  delete from public.brand_analysis_requests where user_id=p_user_id and project_id=p_project_id
    and idempotency_key=p_idempotency_key and status='pending' and claim_hash=p_claim_hash;
end $$;
create or replace function public.resolve_brand_challenge(p_user_id uuid,p_project_id uuid,p_resolution jsonb,p_expected_project_version bigint)
returns setof public.brand_challenge_resolutions language plpgsql security definer set search_path='' as $$
declare candidate public.brand_challenge_resolutions; begin
  perform public.lock_brand_project(p_user_id,p_project_id);
  candidate := jsonb_populate_record(null::public.brand_challenge_resolutions,p_resolution);
  if candidate.user_id<>p_user_id or candidate.project_id<>p_project_id or candidate.resolved_by<>p_user_id
     or candidate.version<>1 or candidate.state not in ('resolved','deferred','overridden') then
    raise exception 'invalid_scope' using errcode='23514';
  end if;
  if not exists(select 1 from public.brand_nodes where user_id=p_user_id and project_id=p_project_id
                and id=candidate.challenge_id and node_type='challenge' and state<>'trash') then
    raise exception 'challenge_missing' using errcode='P2005';
  end if;
  if exists(select 1 from public.brand_challenge_resolutions where user_id=p_user_id
      and project_id=p_project_id and challenge_id=candidate.challenge_id) then
    raise exception 'resolution_conflict' using errcode='P2301';
  end if;
  update public.brand_projects set version=version+1,updated_at=now()
    where user_id=p_user_id and id=p_project_id and version=p_expected_project_version;
  if not found then raise exception 'version_conflict' using errcode='40001'; end if;
  return query insert into public.brand_challenge_resolutions select candidate.* returning *;
end $$;
create or replace function public.create_brand_blueprint_snapshot(p_user_id uuid,p_project_id uuid,p_snapshot jsonb,p_expected_project_version bigint)
returns setof public.brand_blueprint_snapshots language plpgsql security definer set search_path='' as $$
declare candidate public.brand_blueprint_snapshots; existing public.brand_blueprint_snapshots;
        current_version bigint; next_sequence bigint; begin
  perform public.lock_brand_project(p_user_id,p_project_id);
  select version into current_version from public.brand_projects
    where user_id=p_user_id and id=p_project_id for update;
  if current_version is null then raise exception 'project_missing' using errcode='P2100'; end if;
  if current_version<>p_expected_project_version then
    raise exception 'version_conflict' using errcode='40001';
  end if;
  select * into existing from public.brand_blueprint_snapshots
    where user_id=p_user_id and project_id=p_project_id
      and project_version=p_expected_project_version for update;
  if existing.id is not null then return next existing; return; end if;
  candidate := jsonb_populate_record(null::public.brand_blueprint_snapshots,p_snapshot);
  select coalesce(max(sequence),0)+1 into next_sequence from public.brand_blueprint_snapshots
    where user_id=p_user_id and project_id=p_project_id;
  if candidate.user_id<>p_user_id or candidate.project_id<>p_project_id
     or candidate.project_version<>p_expected_project_version or candidate.version<>1
     or candidate.sequence<>next_sequence or candidate.id is null or candidate.created_at is null
     or jsonb_typeof(candidate.canonical_json::jsonb)<>'object'
     or jsonb_typeof(candidate.node_ids)<>'array' or jsonb_typeof(candidate.edge_ids)<>'array'
     or jsonb_typeof(candidate.readiness_warnings)<>'array'
     or jsonb_typeof(candidate.unresolved_assumption_ids)<>'array' then
    raise exception 'invalid_snapshot' using errcode='23514';
  end if;
  return query insert into public.brand_blueprint_snapshots select candidate.* returning *;
end $$;
create or replace function public.save_brand_layout(p_user_id uuid,p_project_id uuid,p_positions jsonb,p_expected_version bigint) returns bigint language plpgsql security definer set search_path='' as $$ declare v bigint; begin perform public.lock_brand_project(p_user_id,p_project_id); if jsonb_typeof(p_positions)<>'object' or exists(select 1 from jsonb_each(p_positions) where key='' or jsonb_typeof(value)<>'array' or jsonb_array_length(value)<>2 or jsonb_typeof(value->0)<>'number' or jsonb_typeof(value->1)<>'number') then raise exception 'invalid_layout' using errcode='23514'; end if; select version into v from public.brand_layouts where user_id=p_user_id and project_id=p_project_id for update; if v is null and p_expected_version<>0 then raise exception 'version_conflict' using errcode='40001'; end if; if v is null then insert into public.brand_layouts(user_id,project_id,positions,version) values(p_user_id,p_project_id,p_positions,1); elsif v<>p_expected_version then raise exception 'version_conflict' using errcode='40001'; else update public.brand_layouts set positions=p_positions,version=v+1,updated_at=now() where user_id=p_user_id and project_id=p_project_id; end if; return p_expected_version+1; end $$;
create or replace function public.begin_brand_media_deletion(p_user_id uuid,p_project_id uuid,p_media_id uuid,p_expected_version bigint,p_claim_hash text) returns text language plpgsql security definer set search_path='' as $$ declare m public.brand_media; begin perform public.lock_brand_project(p_user_id,p_project_id); select * into m from public.brand_media where user_id=p_user_id and project_id=p_project_id and id=p_media_id for update; if m.id is null then raise exception 'media_missing' using errcode='P2005'; end if; if exists(select 1 from public.brand_annotations a where a.user_id=p_user_id and a.project_id=p_project_id and a.media_id=p_media_id) then raise exception 'media_referenced' using errcode='P2004'; end if; if p_claim_hash is null and m.version<>p_expected_version then raise exception 'version_conflict' using errcode='40001'; end if; if p_claim_hash is not null and (m.claim_hash is null or extensions.digest(m.claim_hash,'sha256')<>extensions.digest(p_claim_hash,'sha256')) then raise exception 'claim_mismatch' using errcode='P2006'; end if; update public.brand_media set deletion_pending=true where user_id=p_user_id and project_id=p_project_id and id=p_media_id; return m.storage_key; end $$;
create or replace function public.finalize_brand_media_deletion(p_user_id uuid,p_project_id uuid,p_media_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin perform public.lock_brand_project(p_user_id,p_project_id); delete from public.brand_media where user_id=p_user_id and project_id=p_project_id and id=p_media_id and deletion_pending; if not found then raise exception 'version_conflict' using errcode='40001'; end if; end $$;
create or replace function public.cancel_brand_media_deletion(p_user_id uuid,p_project_id uuid,p_media_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin perform public.lock_brand_project(p_user_id,p_project_id); update public.brand_media set deletion_pending=false where user_id=p_user_id and project_id=p_project_id and id=p_media_id and deletion_pending; end $$;
create or replace function public.list_brand_project_summary_inputs(p_user_id uuid,p_limit integer)
returns table(summary jsonb) language plpgsql security definer set search_path='' as $$ begin
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'invalid_limit' using errcode='22023';
  end if;
  return query
  with locked_projects as materialized (
    select p.* from public.brand_projects p
      where p.user_id=p_user_id order by p.id limit p_limit for share
  )
  select jsonb_build_object(
    'project',to_jsonb(p),
    'nodes',coalesce((select jsonb_agg(to_jsonb(n) order by n.id)
      from public.brand_nodes n where n.user_id=p_user_id and n.project_id=p.id),'[]'::jsonb),
    'resolutions',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id)
      from public.brand_challenge_resolutions r where r.user_id=p_user_id and r.project_id=p.id),'[]'::jsonb)
  ) from locked_projects p order by p.id;
end $$;

revoke all on function public.create_brand_node(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.update_brand_node(uuid,uuid,jsonb,jsonb,bigint,bigint) from public,anon,authenticated;
revoke all on function public.delete_brand_node(uuid,uuid,uuid,bigint,bigint) from public,anon,authenticated;
revoke all on function public.create_brand_edge(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.update_brand_edge(uuid,uuid,jsonb,bigint,bigint) from public,anon,authenticated;
revoke all on function public.delete_brand_edge(uuid,uuid,uuid,bigint,bigint) from public,anon,authenticated;
revoke all on function public.create_brand_edge_direct(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.update_brand_edge_direct(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.replace_brand_annotations(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.get_brand_annotations(uuid,uuid) from public,anon,authenticated;
revoke all on function public.accept_brand_proposal(uuid,uuid,jsonb,jsonb,jsonb,bigint,bigint) from public,anon,authenticated;
revoke all on function public.resolve_brand_challenge(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.create_brand_blueprint_snapshot(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.claim_brand_analysis_request(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.complete_brand_analysis_request(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.abandon_brand_analysis_request(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.save_brand_layout(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.begin_brand_media_deletion(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
revoke all on function public.finalize_brand_media_deletion(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.cancel_brand_media_deletion(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.list_brand_project_summary_inputs(uuid,integer) from public,anon,authenticated;
revoke all on function public.lock_brand_project(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_brand_node(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.update_brand_node(uuid,uuid,jsonb,jsonb,bigint,bigint) to service_role;
grant execute on function public.delete_brand_node(uuid,uuid,uuid,bigint,bigint) to service_role;
grant execute on function public.create_brand_edge(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.update_brand_edge(uuid,uuid,jsonb,bigint,bigint) to service_role;
grant execute on function public.delete_brand_edge(uuid,uuid,uuid,bigint,bigint) to service_role;
grant execute on function public.create_brand_edge_direct(uuid,uuid,jsonb) to service_role;
grant execute on function public.update_brand_edge_direct(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.replace_brand_annotations(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.get_brand_annotations(uuid,uuid) to service_role;
grant execute on function public.accept_brand_proposal(uuid,uuid,jsonb,jsonb,jsonb,bigint,bigint) to service_role;
grant execute on function public.resolve_brand_challenge(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.create_brand_blueprint_snapshot(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.claim_brand_analysis_request(uuid,uuid,text,text,text,integer) to service_role;
grant execute on function public.complete_brand_analysis_request(uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.abandon_brand_analysis_request(uuid,uuid,text,text) to service_role;
grant execute on function public.save_brand_layout(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.begin_brand_media_deletion(uuid,uuid,uuid,bigint,text) to service_role;
grant execute on function public.finalize_brand_media_deletion(uuid,uuid,uuid) to service_role;
grant execute on function public.cancel_brand_media_deletion(uuid,uuid,uuid) to service_role;
grant execute on function public.list_brand_project_summary_inputs(uuid,integer) to service_role;
grant execute on function public.lock_brand_project(uuid,uuid) to service_role;
