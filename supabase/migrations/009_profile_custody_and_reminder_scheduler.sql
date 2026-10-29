-- CampusShare migration 009: close profile role escalation, minimize public custody data,
-- and install the required 15-minute reminder scheduler.

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
  -- No-op for changes that do not touch protected profile fields.
  if old.primary_role is not distinct from new.primary_role
     and old.campus_affiliation_status is not distinct from new.campus_affiliation_status
     and old.owner_verification_status is not distinct from new.owner_verification_status
     and old.verifier_user_id is not distinct from new.verifier_user_id then
    return new;
  end if;

  -- Anonymous requests must never make protected profile changes. Allow only
  -- trusted service-role automation when no end-user identity is present.
  if v_caller_id is null then
    if v_auth_role in ('service_role', 'supabase_admin') then
      return new;
    end if;
    raise exception 'Security violation: protected profile changes require an authenticated, authorised actor.';
  end if;

  select p.primary_role
    into v_caller_role
    from public.profiles p
   where p.id = v_caller_id;

  -- Role assignment is strictly administrator-only; managers cannot promote
  -- themselves or anyone else. assign_user_role() independently enforces this.
  if old.primary_role is distinct from new.primary_role
     and v_caller_role is distinct from 'admin' then
    raise exception 'Security violation: only a system administrator can change primary roles.';
  end if;

  -- Affiliation/owner verification may be requested by the profile owner
  -- (moving only to pending); only campus staff may decide or assign verifier.
  if old.campus_affiliation_status is distinct from new.campus_affiliation_status then
    if new.id = v_caller_id and new.campus_affiliation_status = 'pending' then
      null;
    elsif v_caller_role not in ('manager', 'admin') then
      raise exception 'Security violation: only campus staff may decide affiliation status.';
    end if;
  end if;

  if old.owner_verification_status is distinct from new.owner_verification_status then
    if new.id = v_caller_id and new.owner_verification_status = 'pending' then
      null;
    elsif v_caller_role not in ('manager', 'admin') then
      raise exception 'Security violation: only campus staff may decide owner verification status.';
    end if;
  end if;

  if old.verifier_user_id is distinct from new.verifier_user_id
     and v_caller_role not in ('manager', 'admin') then
    raise exception 'Security violation: only campus staff may assign a verifier.';
  end if;

  return new;
end;
$function$;

-- Public catalogue pages only need to know whether a published resource is in
-- custody. Do not expose booking ids or exact due times through a public RPC.
drop function if exists public.get_active_resource_custody();
create function public.get_active_resource_custody()
returns table(resource_id uuid)
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select distinct b.resource_id
    from public.bookings b
    join public.resources r on r.id = b.resource_id
   where b.status in ('in_use', 'return_pending')
     and (r.state = 'published'
          or r.owner_id = auth.uid()
          or public.is_admin_or_manager());
$function$;

revoke all on function public.get_active_resource_custody() from public, anon, authenticated;
grant execute on function public.get_active_resource_custody() to anon, authenticated;

-- Supabase Cron uses pg_cron. If it cannot be enabled on this instance this
-- migration should fail, leaving the absence visible instead of a false success.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $schedule$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select j.jobid from cron.job j where j.jobname = 'campusshare-due-reminders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'campusshare-due-reminders',
    '*/15 * * * *',
    'select public.generate_due_reminders();'
  );
end;
$schedule$;

comment on function public.get_active_resource_custody() is
  'Returns only resource ids with active custody; never exposes booking identifiers or exact due times.';
