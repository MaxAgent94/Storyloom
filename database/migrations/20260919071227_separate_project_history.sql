-- Keep large chat/proposal history out of routine manuscript updates. Additive,
-- lazy conversion keeps old clients and the original save RPC compatible.
alter table public.projects add column history jsonb not null default '{}';
alter table public.projects add column history_order jsonb not null default '{}';

create function public.project_collection_delta(p_previous jsonb, p_patch jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare items jsonb; result jsonb; count_order integer;
begin
 if jsonb_typeof(p_patch->'order') is distinct from 'array'
 or jsonb_typeof(p_patch->'changed') is distinct from 'array' then
  raise exception 'Invalid project update';
 end if;
 count_order := jsonb_array_length(p_patch->'order');
 if exists(select 1 from jsonb_array_elements(p_patch->'order') x where jsonb_typeof(x) <> 'string')
 or (select count(distinct value) from jsonb_array_elements(p_patch->'order')) <> count_order
 or exists(select 1 from jsonb_array_elements(p_patch->'changed') x where jsonb_typeof(x->'id') is distinct from 'string')
 or (select count(distinct value->>'id') from jsonb_array_elements(p_patch->'changed')) <> jsonb_array_length(p_patch->'changed') then
  raise exception 'Invalid project update';
 end if;
 select coalesce(jsonb_object_agg(value->>'id',value),'{}') into items
 from jsonb_array_elements(coalesce(p_previous,'[]'));
 select items || coalesce(jsonb_object_agg(value->>'id',value),'{}') into items
 from jsonb_array_elements(p_patch->'changed');
 if exists(select 1 from jsonb_array_elements_text(p_patch->'order') x where not (items ? x)) then
  raise exception 'Incomplete project update';
 end if;
 select coalesce(jsonb_agg(items->x.id order by x.position),'[]') into result
 from jsonb_array_elements_text(p_patch->'order') with ordinality as x(id,position);
 return result;
end $$;
revoke all on function public.project_collection_delta(jsonb,jsonb) from public;
grant execute on function public.project_collection_delta(jsonb,jsonb) to authenticated;

create function public.save_project_v2(p_id uuid, p_expected integer, p_body jsonb default null,
 p_delta jsonb default null, p_meta jsonb default '{}') returns integer
language plpgsql security invoker set search_path='' as $$
declare core jsonb; saved_order jsonb; archive jsonb; next_core jsonb;
 rev integer; k text; patch jsonb; ids jsonb; archive_dirty boolean := false;
begin
 if auth.uid() is null or not exists(select 1 from public.allowed_users where user_id=auth.uid()) then
  raise exception 'Unauthorized';
 end if;
 if p_expected is null or (p_body is null) = (p_delta is null) then raise exception 'Invalid project update'; end if;
 select body,revision,history_order into core,rev,saved_order from public.projects where id=p_id for update;
 if (rev is null and p_expected <> 0) or (rev is not null and rev <> p_expected) then raise exception 'Save conflict'; end if;
 if p_delta is not null and core is null then raise exception 'Save conflict'; end if;
 if coalesce(p_delta->>'id',p_body->>'id','') <> p_id::text then raise exception 'Project mismatch'; end if;
 saved_order := coalesce(saved_order,'{}');

 -- A legacy writer may have re-embedded history. Prefer it when present.
 if core ? 'messages' or core ? 'proposals' then
  select history into archive from public.projects where id=p_id;
  for k in select unnest(array['messages','proposals']) loop
   if core ? k then archive := jsonb_set(archive,array[k],core->k); end if;
   select coalesce(jsonb_agg(value->'id'),'[]') into ids from jsonb_array_elements(coalesce(archive->k,'[]'));
   saved_order := jsonb_set(saved_order,array[k],ids);
  end loop;
  core := core - 'messages' - 'proposals';
  -- The existing versioning RPC must compare compact bodies, even on conversion.
  update public.projects set body=core where id=p_id;
  archive_dirty := true;
 end if;

 if p_body is not null then
  next_core := p_body - 'messages' - 'proposals';
  archive := jsonb_build_object('messages',p_body->'messages','proposals',p_body->'proposals');
  archive_dirty := true;
  for k in select unnest(array['messages','proposals']) loop
   select coalesce(jsonb_agg(value->'id'),'[]') into ids from jsonb_array_elements(archive->k);
   saved_order := jsonb_set(saved_order,array[k],ids);
  end loop;
 else
  next_core := jsonb_set(core,'{title}',p_delta->'title');
  for k in select unnest(array['nodes','presets','messages','proposals']) loop
   patch := p_delta->'collections'->k;
   if jsonb_typeof(patch->'order') is distinct from 'array' or jsonb_typeof(patch->'changed') is distinct from 'array' then
    raise exception 'Invalid project update';
   end if;
   if k in ('nodes','presets') then
    next_core := jsonb_set(next_core,array[k],public.project_collection_delta(core->k,patch));
   elsif patch->'changed' <> '[]'::jsonb or patch->'order' is distinct from coalesce(saved_order->k,'[]') then
    if archive is null then select history into archive from public.projects where id=p_id; end if;
    archive := jsonb_set(archive,array[k],public.project_collection_delta(archive->k,patch));
    saved_order := jsonb_set(saved_order,array[k],patch->'order');
    archive_dirty := true;
   end if;
  end loop;
 end if;
 -- Retain the existing atomic revision checks and section history semantics.
 rev := public.save_project(p_id,next_core,p_expected,p_meta);
 if archive_dirty then
  update public.projects set history=archive,history_order=saved_order where id=p_id;
 end if;
 return rev;
end $$;
revoke all on function public.save_project_v2(uuid,integer,jsonb,jsonb,jsonb) from public;
grant execute on function public.save_project_v2(uuid,integer,jsonb,jsonb,jsonb) to authenticated;
