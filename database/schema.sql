-- Run only in the NEW Storyloom Supabase project.
create table public.allowed_users (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.allowed_users enable row level security;
grant select on public.allowed_users to authenticated;
create policy own_access on public.allowed_users for select to authenticated using ((select auth.uid())=user_id);
create table public.projects (id uuid primary key, user_id uuid not null references auth.users(id),title text not null,body jsonb not null,revision integer not null default 0,updated_at timestamptz not null default now());
create index projects_owner on public.projects(user_id);
alter table public.projects enable row level security;
grant select,insert,update on public.projects to authenticated;
create policy own_projects on public.projects for all to authenticated using (user_id=(select auth.uid()) and exists(select 1 from public.allowed_users a where a.user_id=(select auth.uid()))) with check (user_id=(select auth.uid()) and exists(select 1 from public.allowed_users a where a.user_id=(select auth.uid())));
create table public.section_versions (id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id),user_id uuid not null references auth.users(id),node_id text not null,section text not null,content text not null,metadata jsonb not null default '{}',created_at timestamptz not null default now());
create index versions_lookup on public.section_versions(project_id,node_id,section,created_at desc);
create index versions_owner on public.section_versions(user_id);
alter table public.section_versions enable row level security;
grant select,insert on public.section_versions to authenticated;
create policy own_versions_read on public.section_versions for select to authenticated using(user_id=(select auth.uid()));
create policy own_versions_insert on public.section_versions for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.projects p where p.id=project_id and p.user_id=(select auth.uid())));
create table public.provider_credentials(user_id uuid primary key references auth.users(id),ciphertext text not null,updated_at timestamptz not null default now());
alter table public.provider_credentials enable row level security;
grant select,insert,update,delete on public.provider_credentials to authenticated;
create policy own_credentials on public.provider_credentials for all to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.allowed_users a where a.user_id=(select auth.uid()))) with check(user_id=(select auth.uid()) and exists(select 1 from public.allowed_users a where a.user_id=(select auth.uid())));
create or replace function public.save_project(p_id uuid,p_body jsonb,p_expected integer,p_meta jsonb default '{}') returns integer language plpgsql security invoker set search_path='' as $$
declare old_body jsonb; rev integer; n jsonb; s record; old_text text;
begin
 if auth.uid() is null or not exists(select 1 from public.allowed_users where user_id=auth.uid()) then raise exception 'Unauthorized'; end if;
 select body,revision into old_body,rev from public.projects where id=p_id for update;
 if not found then
  if p_expected<>0 then raise exception 'Save conflict'; end if;
  insert into public.projects(id,user_id,title,body,revision) values(p_id,auth.uid(),p_body->>'title',p_body,1);
  rev:=1; old_body:='{"nodes":[]}';
 else
  if rev<>p_expected then raise exception 'Save conflict'; end if;
  rev:=rev+1;
  update public.projects set body=p_body,title=p_body->>'title',revision=rev,updated_at=now() where id=p_id;
 end if;
 for n in select value from jsonb_array_elements(p_body->'nodes') loop
  for s in select key,value from jsonb_each_text(n->'sections') loop
   select value->'sections'->>s.key into old_text from jsonb_array_elements(old_body->'nodes') where value->>'id'=n->>'id';
   if old_text is distinct from s.value then
    if old_text is null then
     insert into public.section_versions(project_id,user_id,node_id,section,content,metadata) values(p_id,auth.uid(),n->>'id',s.key,'','{"action":"initial"}');
    end if;
    insert into public.section_versions(project_id,user_id,node_id,section,content,metadata) values(p_id,auth.uid(),n->>'id',s.key,s.value,p_meta||jsonb_build_object('revision',rev));
   end if;
  end loop;
 end loop;
 return rev;
end $$;
revoke all on function public.save_project(uuid,jsonb,integer,jsonb) from public;
grant execute on function public.save_project(uuid,jsonb,integer,jsonb) to authenticated;
-- Create your personal user via Supabase Dashboard > Authentication > Add user.
-- Disable public signups. Insert that user's UUID into allowed_users using the SQL editor.
-- No service-role key is used by the application.

-- Completed model responses survive a closed tab or failed client-side save.
create table public.generations(id uuid primary key,project_id uuid not null references public.projects(id),user_id uuid not null references auth.users(id),record jsonb not null,created_at timestamptz not null default now());
create index generations_project on public.generations(project_id,created_at desc);
create index generations_owner on public.generations(user_id);
alter table public.generations enable row level security;
grant select,insert on public.generations to authenticated;
create policy own_generations_read on public.generations for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.allowed_users a where a.user_id=(select auth.uid())));
create policy own_generations_insert on public.generations for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.projects p where p.id=project_id and p.user_id=(select auth.uid())));
create or replace function public.delete_project(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 if auth.uid() is null or not exists(select 1 from public.allowed_users where user_id=auth.uid()) then raise exception 'Unauthorized'; end if;
 if not exists(select 1 from public.projects where id=p_id and user_id=auth.uid()) then return false; end if;
 delete from public.generations where project_id=p_id and user_id=auth.uid();
 delete from public.section_versions where project_id=p_id and user_id=auth.uid();
 delete from public.projects where id=p_id and user_id=auth.uid();
 get diagnostics removed = row_count;
 return removed=1;
end $$;
revoke all on function public.delete_project(uuid) from public, anon;
grant execute on function public.delete_project(uuid) to authenticated;
