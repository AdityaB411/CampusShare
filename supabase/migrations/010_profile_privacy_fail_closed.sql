-- CampusShare migration 010: fail-closed profile verification checks and scoped profile visibility.

create or replace function public.check_profile_elevation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_auth_role text := coalesce(auth.role(), '');
begin
  if old.primary_role is not distinct from new.primary_role
     and old.campus_affiliation_status is not distinct from new.campus_affiliation_status
     and old.owner_verification_status is not distinct from new.owner_verification_status
     and old.verifier_user_id is not distinct from new.verifier_user_id then
    return new;
  end if;

  if v_caller_id is null then
    if v_auth_role in ('service_role', 'supabase_admin') then
      return new;
    end if;
    raise exception 'Security violation: protected profile changes require an authenticated, authorised actor.';
  end if;

  select p.primary_role into v_caller_role
    from public.profiles p where p.id = v_caller_id;

  if old.primary_role is distinct from new.primary_role
     and v_caller_role is distinct from 'admin' then
    raise exception 'Security violation: only a system administrator can change primary roles.';
  end if;

  if old.campus_affiliation_status is distinct from new.campus_affiliation_status then
    if new.id = v_caller_id and new.campus_affiliation_status = 'pending' then
      null;
    elsif coalesce(v_caller_role, '') not in ('manager', 'admin') then
      raise exception 'Security violation: only campus staff may decide affiliation status.';
    end if;
  end if;

  if old.owner_verification_status is distinct from new.owner_verification_status then
    if new.id = v_caller_id and new.owner_verification_status = 'pending' then
      null;
    elsif coalesce(v_caller_role, '') not in ('manager', 'admin') then
      raise exception 'Security violation: only campus staff may decide owner verification status.';
    end if;
  end if;

  if old.verifier_user_id is distinct from new.verifier_user_id
     and coalesce(v_caller_role, '') not in ('manager', 'admin') then
    raise exception 'Security violation: only campus staff may assign a verifier.';
  end if;

  return new;
end;
$function$;

drop policy if exists "Authenticated users can view profiles" on public.profiles;
create policy "Users can view relevant profiles"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_admin_or_manager()
    or exists (
      select 1 from public.resources r
       where r.owner_id = profiles.id
         and r.state = 'published'
    )
    or exists (
      select 1
        from public.bookings b
        join public.resources r on r.id = b.resource_id
       where
         (b.requester_id = profiles.id and
           (r.owner_id = (select auth.uid()) or b.supervisor_user_id = (select auth.uid())))
         or
         (r.owner_id = profiles.id and b.requester_id = (select auth.uid()))
         or
         (b.supervisor_user_id = profiles.id and b.requester_id = (select auth.uid()))
    )
  );
