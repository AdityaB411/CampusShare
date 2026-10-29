-- CampusShare migration 020: preserve group-membership decision semantics and notify each real transition.
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
  v_notification_key text;
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
      approved_by = case when p_status = 'approved' then v_user_id else null end
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

  v_notification_key := 'group_membership_decision_' || p_member_id::text || '_' || p_status || '_' || gen_random_uuid()::text;

  insert into public.notifications (
    recipient_id, type, related_entity_type, related_entity_id, message, dedupe_key
  ) values (
    v_member.user_id, 'general', 'group_membership', p_member_id,
    'Your membership in project group "' || coalesce(v_group_name, 'your group') || '" is now ' || p_status || '.',
    v_notification_key
  ) on conflict do nothing;

  return jsonb_build_object('success', true, 'member_id', p_member_id, 'status', p_status, 'changed', true);
end;
$function$;
comment on function public.decide_group_membership(uuid, text) is
  'Validates and locks group membership decisions, records actual state changes, stores approved_by only for approvals, and notifies the affected member once per actual transition.';
