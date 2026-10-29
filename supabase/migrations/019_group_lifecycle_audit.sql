-- CampusShare migration 019: complete audit and notification coverage for project-group lifecycle changes.
CREATE OR REPLACE FUNCTION public.verify_project_group(p_group_id uuid, p_is_verified boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_group record;
  v_actor_role text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_is_verified is null then
    raise exception 'Validation error: Group verification status must be true or false.';
  end if;

  if not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only managers or admins can verify project groups.';
  end if;

  select * into v_group from public.project_groups where id = p_group_id for update;
  if not found then
    raise exception 'Project group not found.';
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  update public.project_groups
  set is_verified = p_is_verified,
      reviewer_id = v_user_id
  where id = p_group_id;

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
    coalesce(v_actor_role, 'manager'),
    'project_group',
    p_group_id,
    case when p_is_verified then 'GROUP_VERIFIED' else 'GROUP_REVOKED' end,
    v_group.is_verified::text,
    p_is_verified::text,
    'Project group status updated by manager',
    jsonb_build_object('group_name', v_group.name)
  );

  return jsonb_build_object('success', true, 'group_id', p_group_id, 'is_verified', p_is_verified);
end;
$function$;

CREATE OR REPLACE FUNCTION public.decide_group_membership(p_member_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_member record;
  v_actor_role text;
  v_group_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only managers or admins can decide group memberships.';
  end if;

  if p_status is null or p_status not in ('approved', 'pending', 'removed') then
    raise exception 'Invalid status: %', p_status;
  end if;

  select * into v_member from public.group_members where id = p_member_id for update;
  if not found then
    raise exception 'Group membership record not found.';
  end if;

  if v_member.status = p_status then
    return jsonb_build_object('success', true, 'member_id', p_member_id, 'status', p_status, 'changed', false);
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;
  select name into v_group_name from public.project_groups where id = v_member.group_id;

  update public.group_members
  set status = p_status,
      approved_by = v_user_id
  where id = p_member_id;

  insert into public.activity_events (
    actor_id, actor_role_snapshot, entity_type, entity_id, action,
    previous_state, new_state, reason, metadata
  ) values (
    v_user_id, coalesce(v_actor_role, 'manager'), 'group_membership', p_member_id,
    'GROUP_MEMBERSHIP_STATUS_CHANGED', v_member.status, p_status,
    'Group membership status changed by campus management.',
    jsonb_build_object('group_id', v_member.group_id, 'user_id', v_member.user_id, 'group_name', v_group_name)
  );

  insert into public.notifications (
    recipient_id, type, related_entity_type, related_entity_id, message, dedupe_key
  ) values (
    v_member.user_id, 'general', 'group_membership', p_member_id,
    'Your membership in project group "' || coalesce(v_group_name, 'your group') || '" is now ' || p_status || '.',
    'group_membership_decision_' || p_member_id::text || '_' || p_status
  ) on conflict do nothing;

  return jsonb_build_object('success', true, 'member_id', p_member_id, 'status', p_status, 'changed', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_project_group(p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_clean_name text;
  v_group_id uuid;
  v_member_id uuid;
  v_actor_role text;
  v_is_staff boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  v_clean_name := trim(coalesce(p_name, ''));
  if length(v_clean_name) < 3 or length(v_clean_name) > 100 then
    raise exception 'Group name must be between 3 and 100 characters.';
  end if;

  v_is_staff := public.is_admin_or_manager();
  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  -- Insert project group (auto-verified if created by staff, pending if student)
  insert into public.project_groups (
    name,
    is_verified,
    reviewer_id
  ) values (
    v_clean_name,
    v_is_staff,
    case when v_is_staff then v_user_id else null end
  ) returning id into v_group_id;

  -- Add creator as approved group member
  insert into public.group_members (
    group_id,
    user_id,
    status,
    approved_by
  ) values (
    v_group_id,
    v_user_id,
    'approved',
    case when v_is_staff then v_user_id else null end
  ) returning id into v_member_id;

  insert into public.activity_events (
    actor_id, actor_role_snapshot, entity_type, entity_id, action,
    previous_state, new_state, reason, metadata
  ) values (
    v_user_id, coalesce(v_actor_role, 'borrower'), 'project_group', v_group_id,
    'PROJECT_GROUP_CREATED', null, case when v_is_staff then 'verified' else 'pending_verification' end,
    'Project group created; staff verification is required before group bookings.',
    jsonb_build_object('group_name', v_clean_name, 'created_by', v_user_id)
  );

  insert into public.activity_events (
    actor_id, actor_role_snapshot, entity_type, entity_id, action,
    previous_state, new_state, reason, metadata
  ) values (
    v_user_id, coalesce(v_actor_role, 'borrower'), 'group_membership', v_member_id,
    'GROUP_MEMBERSHIP_CREATED', null, 'approved',
    'Creator added as the initial group member.',
    jsonb_build_object('group_id', v_group_id, 'user_id', v_user_id, 'group_name', v_clean_name)
  );

  return jsonb_build_object(
    'success', true,
    'group_id', v_group_id,
    'name', v_clean_name,
    'is_verified', v_is_staff
  );
end;
$function$;

comment on function public.create_project_group(text) is
  'Creates a bounded-length project group and records both group creation and creator membership in the append-only Trust Record.';
comment on function public.decide_group_membership(uuid, text) is
  'Validates and locks group membership decisions, records each actual state change in the Trust Record, and notifies the affected member.';
comment on function public.verify_project_group(uuid, boolean) is
  'Allows staff-only, null-safe, row-locked project group verification decisions with Trust Record audit.';
