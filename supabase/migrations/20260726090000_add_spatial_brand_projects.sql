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
  id uuid not null, user_id uuid not null, project_id uuid not null, node_type text not null,
  title text not null, content text not null, state text not null, created_by text not null,
  provenance text, tags jsonb not null default '[]', version bigint not null check(version>0),
  created_at timestamptz not null, updated_at timestamptz not null, primary key(user_id,project_id,id),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);
create table public.brand_edges (
  id uuid not null, user_id uuid not null, project_id uuid not null, source_node_id uuid not null,
  target_node_id uuid not null, edge_type text not null, label text, version bigint not null check(version>0),
  created_at timestamptz not null, updated_at timestamptz not null, primary key(user_id,project_id,id),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade,
  foreign key(user_id,project_id,source_node_id) references public.brand_nodes(user_id,project_id,id),
  foreign key(user_id,project_id,target_node_id) references public.brand_nodes(user_id,project_id,id),
  unique(user_id,project_id,source_node_id,target_node_id,edge_type), check(source_node_id<>target_node_id)
);
create table public.brand_node_revisions (
  id uuid not null, user_id uuid not null, project_id uuid not null, node_id uuid not null,
  node_version bigint not null check(node_version>0), title text not null, content text not null,
  node_type text not null, state text not null, created_by text not null, provenance text, tags jsonb not null,
  created_at timestamptz not null, primary key(user_id,project_id,id),
  foreign key(user_id,project_id,node_id) references public.brand_nodes(user_id,project_id,id) on delete cascade
);
create table public.brand_layouts (
  user_id uuid not null, project_id uuid not null, positions jsonb not null default '{}',
  version bigint not null check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(user_id,project_id), foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);
create table public.brand_media (
  id uuid not null, user_id uuid not null, project_id uuid not null, owner_id uuid not null,
  storage_key text not null check(storage_key !~ '[/\\:]'), mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
  byte_length bigint not null check(byte_length between 1 and 5242880), sha256 text not null, claim_hash text,
  version bigint not null check(version>0), created_at timestamptz not null, updated_at timestamptz not null,
  primary key(user_id,project_id,id), unique(storage_key), check(owner_id=user_id),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);
create table public.brand_annotations (
  id uuid not null, user_id uuid not null, project_id uuid not null, owner_id uuid not null,
  annotation_type text not null check(annotation_type in ('freehand','media')), path_points jsonb not null default '[]',
  color text, media_id uuid, version bigint not null check(version>0), created_at timestamptz not null, updated_at timestamptz not null,
  primary key(user_id,project_id,id), check(owner_id=user_id),
  check((annotation_type='freehand' and media_id is null and color is not null) or
        (annotation_type='media' and media_id is not null and color is null)),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade,
  foreign key(user_id,project_id,media_id) references public.brand_media(user_id,project_id,id)
);
create table public.brand_user_preferences (
  user_id uuid not null references auth.users(id) on delete cascade, theme text not null check(theme in ('paper','graphite','project')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(user_id)
);
create table public.brand_proposals (
  id uuid not null, user_id uuid not null, project_id uuid not null, title text not null, rationale text not null,
  target_node_ids jsonb not null, creation_source text not null, state text not null check(state in ('pending','accepted','rejected')),
  version bigint not null check(version>0), created_at timestamptz not null, updated_at timestamptz not null,
  primary key(user_id,project_id,id), foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);
create table public.brand_analysis_cache (
  user_id uuid not null, project_id uuid not null, cache_key text not null, analysis jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(user_id,project_id,cache_key),
  foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);
create table public.brand_blueprint_snapshots (
  id uuid not null, user_id uuid not null, project_id uuid not null, name text not null,
  node_ids jsonb not null, edge_ids jsonb not null, version bigint not null check(version>0), created_at timestamptz not null,
  primary key(user_id,project_id,id), foreign key(user_id,project_id) references public.brand_projects(user_id,id) on delete cascade
);

alter table public.brand_projects enable row level security;
alter table public.brand_nodes enable row level security;
alter table public.brand_edges enable row level security;
alter table public.brand_node_revisions enable row level security;
alter table public.brand_layouts enable row level security;
alter table public.brand_media enable row level security;
alter table public.brand_annotations enable row level security;
alter table public.brand_user_preferences enable row level security;
alter table public.brand_proposals enable row level security;
alter table public.brand_analysis_cache enable row level security;
alter table public.brand_blueprint_snapshots enable row level security;

create index brand_projects_owner_status_idx on public.brand_projects(user_id,status,updated_at desc);
create index brand_nodes_owner_project_state_idx on public.brand_nodes(user_id,project_id,state);
create index brand_edges_owner_project_idx on public.brand_edges(user_id,project_id);
create index brand_proposals_owner_project_state_idx on public.brand_proposals(user_id,project_id,state);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('brand-canvas-media', 'brand-canvas-media', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.lock_brand_project(p_user_id uuid,p_project_id uuid)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_project_id::text,0));
end $$;

create or replace function public.create_brand_node(p_user_id uuid,p_project_id uuid,p_record jsonb,p_expected_project_version bigint)
returns setof public.brand_nodes language plpgsql security definer set search_path='' as $$ begin
  perform public.lock_brand_project(p_user_id,p_project_id);
  update public.brand_projects set version=version+1,updated_at=now() where user_id=p_user_id and id=p_project_id and version=p_expected_project_version;
  if not found then raise exception 'version_conflict' using errcode='40001'; end if;
  return query insert into public.brand_nodes select * from jsonb_populate_record(null::public.brand_nodes,p_record) returning *;
end $$;
create or replace function public.update_brand_node(p_user_id uuid,p_project_id uuid,p_record jsonb,p_revision jsonb,p_expected_node_version bigint,p_expected_project_version bigint)
returns setof public.brand_nodes language plpgsql security definer set search_path='' as $$ begin
  perform public.lock_brand_project(p_user_id,p_project_id);
  update public.brand_projects set version=version+1,updated_at=now() where user_id=p_user_id and id=p_project_id and version=p_expected_project_version;
  if not found then raise exception 'version_conflict' using errcode='40001'; end if;
  insert into public.brand_node_revisions select * from jsonb_populate_record(null::public.brand_node_revisions,p_revision);
  return query update public.brand_nodes n set node_type=x.node_type,title=x.title,content=x.content,state=x.state,provenance=x.provenance,tags=x.tags,version=x.version,updated_at=x.updated_at
    from jsonb_populate_record(null::public.brand_nodes,p_record) x where n.user_id=p_user_id and n.project_id=p_project_id and n.id=x.id and n.version=p_expected_node_version returning n.*;
end $$;
create or replace function public.delete_brand_node(p_user_id uuid,p_project_id uuid,p_node_id uuid,p_expected_node_version bigint,p_expected_project_version bigint)
returns void language plpgsql security definer set search_path='' as $$ begin perform public.lock_brand_project(p_user_id,p_project_id); delete from public.brand_nodes where user_id=p_user_id and project_id=p_project_id and id=p_node_id and version=p_expected_node_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; update public.brand_projects set version=version+1,updated_at=now() where user_id=p_user_id and id=p_project_id and version=p_expected_project_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; end $$;
create or replace function public.create_brand_edge(p_user_id uuid,p_project_id uuid,p_record jsonb,p_expected_project_version bigint) returns setof public.brand_edges language plpgsql security definer set search_path='' as $$ begin perform public.lock_brand_project(p_user_id,p_project_id); update public.brand_projects set version=version+1 where user_id=p_user_id and id=p_project_id and version=p_expected_project_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; return query insert into public.brand_edges select * from jsonb_populate_record(null::public.brand_edges,p_record) returning *; end $$;
create or replace function public.update_brand_edge(p_user_id uuid,p_project_id uuid,p_record jsonb,p_expected_edge_version bigint,p_expected_project_version bigint) returns setof public.brand_edges language plpgsql security definer set search_path='' as $$ begin perform public.lock_brand_project(p_user_id,p_project_id); update public.brand_projects set version=version+1 where user_id=p_user_id and id=p_project_id and version=p_expected_project_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; return query update public.brand_edges e set edge_type=x.edge_type,label=x.label,version=x.version,updated_at=x.updated_at from jsonb_populate_record(null::public.brand_edges,p_record) x where e.user_id=p_user_id and e.project_id=p_project_id and e.id=x.id and e.version=p_expected_edge_version returning e.*; end $$;
create or replace function public.delete_brand_edge(p_user_id uuid,p_project_id uuid,p_edge_id uuid,p_expected_edge_version bigint,p_expected_project_version bigint) returns void language plpgsql security definer set search_path='' as $$ begin perform public.lock_brand_project(p_user_id,p_project_id); delete from public.brand_edges where user_id=p_user_id and project_id=p_project_id and id=p_edge_id and version=p_expected_edge_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; update public.brand_projects set version=version+1 where user_id=p_user_id and id=p_project_id and version=p_expected_project_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; end $$;
create or replace function public.replace_brand_annotations(p_user_id uuid,p_project_id uuid,p_annotations jsonb,p_expected_version bigint) returns bigint language plpgsql security definer set search_path='' as $$ declare v bigint; begin perform public.lock_brand_project(p_user_id,p_project_id); select coalesce(max(version),0) into v from public.brand_annotations where user_id=p_user_id and project_id=p_project_id; if v<>p_expected_version then raise exception 'version_conflict' using errcode='40001'; end if; delete from public.brand_annotations where user_id=p_user_id and project_id=p_project_id; insert into public.brand_annotations select * from jsonb_populate_recordset(null::public.brand_annotations,p_annotations); return p_expected_version+1; end $$;
create or replace function public.accept_brand_proposal(p_user_id uuid,p_project_id uuid,p_proposal_id uuid,p_expected_project_version bigint) returns setof public.brand_proposals language plpgsql security definer set search_path='' as $$ begin perform public.lock_brand_project(p_user_id,p_project_id); update public.brand_projects set version=version+1,updated_at=now() where user_id=p_user_id and id=p_project_id and version=p_expected_project_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; return query update public.brand_proposals set state='accepted',version=version+1,updated_at=now() where user_id=p_user_id and project_id=p_project_id and id=p_proposal_id and state='pending' returning *; end $$;
create or replace function public.save_brand_layout(p_user_id uuid,p_project_id uuid,p_positions jsonb,p_expected_version bigint) returns bigint language plpgsql security definer set search_path='' as $$ begin perform public.lock_brand_project(p_user_id,p_project_id); insert into public.brand_layouts(user_id,project_id,positions,version) values(p_user_id,p_project_id,p_positions,p_expected_version+1) on conflict(user_id,project_id) do update set positions=excluded.positions,version=excluded.version,updated_at=now() where brand_layouts.version=p_expected_version; if not found then raise exception 'version_conflict' using errcode='40001'; end if; return p_expected_version+1; end $$;
create or replace function public.discard_brand_media_claim(p_user_id uuid,p_project_id uuid,p_media_id uuid,p_claim_hash text) returns text language plpgsql security definer set search_path='' as $$ declare k text; begin delete from public.brand_media where user_id=p_user_id and project_id=p_project_id and id=p_media_id and claim_hash=p_claim_hash returning storage_key into k; return k; end $$;

revoke all on function public.create_brand_node(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.update_brand_node(uuid,uuid,jsonb,jsonb,bigint,bigint) from public,anon,authenticated;
revoke all on function public.delete_brand_node(uuid,uuid,uuid,bigint,bigint) from public,anon,authenticated;
revoke all on function public.create_brand_edge(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.update_brand_edge(uuid,uuid,jsonb,bigint,bigint) from public,anon,authenticated;
revoke all on function public.delete_brand_edge(uuid,uuid,uuid,bigint,bigint) from public,anon,authenticated;
revoke all on function public.replace_brand_annotations(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.accept_brand_proposal(uuid,uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.save_brand_layout(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.discard_brand_media_claim(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_brand_node(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.update_brand_node(uuid,uuid,jsonb,jsonb,bigint,bigint) to service_role;
grant execute on function public.delete_brand_node(uuid,uuid,uuid,bigint,bigint) to service_role;
grant execute on function public.create_brand_edge(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.update_brand_edge(uuid,uuid,jsonb,bigint,bigint) to service_role;
grant execute on function public.delete_brand_edge(uuid,uuid,uuid,bigint,bigint) to service_role;
grant execute on function public.replace_brand_annotations(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.accept_brand_proposal(uuid,uuid,uuid,bigint) to service_role;
grant execute on function public.save_brand_layout(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.discard_brand_media_claim(uuid,uuid,uuid,text) to service_role;
