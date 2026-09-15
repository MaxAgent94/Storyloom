create or replace function public.delete_project(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare removed integer;
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.allowed_users where user_id = auth.uid()
     ) then
    raise exception 'Unauthorized';
  end if;

  if not exists (
    select 1 from public.projects where id = p_id and user_id = auth.uid()
  ) then
    return false;
  end if;

  delete from public.generations
  where project_id = p_id and user_id = auth.uid();

  delete from public.section_versions
  where project_id = p_id and user_id = auth.uid();

  delete from public.projects
  where id = p_id and user_id = auth.uid();

  get diagnostics removed = row_count;
  return removed = 1;
end
$$;

revoke all on function public.delete_project(uuid) from public, anon;
grant execute on function public.delete_project(uuid) to authenticated;
