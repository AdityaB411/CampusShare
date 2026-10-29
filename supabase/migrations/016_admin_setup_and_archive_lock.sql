-- CampusShare migration 016: allow trusted direct SQL setup and serialize archive transitions.
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

  -- SQL Editor / trusted direct PostgreSQL administration has no JWT. Permit
  -- it explicitly; PostgREST requests run as authenticator and cannot satisfy
  -- this condition. Service-role automation remains allowed as well.
  if v_caller_id is null then
    if session_user in ('postgres', 'supabase_admin')
       or v_auth_role in ('service_role', 'supabase_admin') then
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

create or replace function public.archive_resource(
  p_resource_id uuid,
  p_new_state text default 'archived'
)
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_resource record;
  v_actor_role text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_new_state is null or p_new_state not in ('archived', 'paused', 'published', 'draft') then
    raise exception 'Invalid target state: %', p_new_state;
  end if;

  select * into v_resource
  from public.resources
  where id = p_resource_id
  for update;

  if not found then
    raise exception 'Resource not found.';
  end if;

  if v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only the owner or an authorized manager can modify resource state.';
  end if;

  -- Block archiving if there are active bookings currently checked out
  if p_new_state in ('archived', 'paused') and exists (
    select 1 from public.bookings
    where resource_id = p_resource_id
      and status in ('in_use', 'return_pending')
  ) then
    raise exception 'Active custody rule: Cannot % a resource with items currently in use or pending return.', p_new_state;
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  update public.resources
  set state = p_new_state,
      updated_at = now()
  where id = p_resource_id;

  -- Audit event in Trust Record
  insert into public.activity_events (
    actor_id,
    actor_role_snapshot,
    entity_type,
    entity_id,
    action,
    previous_state,
    new_state,
    reason,
    metadata
  ) values (
    v_user_id,
    coalesce(v_actor_role, 'owner'),
    'resource',
    p_resource_id,
    'RESOURCE_STATE_CHANGED',
    v_resource.state,
    p_new_state,
    'Resource state updated by custodian/manager',
    jsonb_build_object('title', v_resource.title)
  );

  return jsonb_build_object('success', true, 'state', p_new_state);
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 3. FUNCTION: CREATE PROJECT GROUP (Borrower or Staff)
-- ==============================================================================

comment on function public.check_profile_elevation() is
  'Protects role/verification fields for API users while permitting trusted direct PostgreSQL administration and service-role automation.';
comment on function public.archive_resource(uuid, text) is
  'Serializes resource state changes with the resource row lock and validates requested state before enforcing custody rules.';
