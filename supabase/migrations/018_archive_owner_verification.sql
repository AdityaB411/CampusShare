-- CampusShare migration 018: require current owner verification for resource state changes.
CREATE OR REPLACE FUNCTION public.archive_resource(p_resource_id uuid, p_new_state text DEFAULT 'archived'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not public.is_admin_or_manager() and not public.is_verified_owner() then
    raise exception 'Permission denied: Resource owner verification is required.';
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
$function$;
comment on function public.archive_resource(uuid, text) is
  'Resource state transitions require an authorized owner or staff member, current owner verification, a row lock, and no active custody before pause/archive.';
