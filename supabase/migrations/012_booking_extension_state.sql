-- CampusShare migration 012: use booking-embedded extension state and remove the legacy table.
create or replace function public.request_booking_extension(
  p_booking_id uuid,
  p_new_end_time timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_resource public.resources%rowtype;
  v_actor_role text;
  v_clean_reason text := trim(coalesce(p_reason, ''));
  v_has_conflict boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required.'; end if;
  if length(v_clean_reason) < 3 or length(v_clean_reason) > 2000 then
    raise exception 'Extension requires a justification between 3 and 2000 characters.';
  end if;
  if p_new_end_time is null then raise exception 'A new end time is required.'; end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if v_booking.requester_id <> v_user_id then
    raise exception 'Permission denied: only the borrower can request an extension.';
  end if;
  if v_booking.status not in ('approved', 'in_use') then
    raise exception 'Extensions can only be requested for approved or in-use bookings.';
  end if;
  if p_new_end_time <= v_booking.end_time then
    raise exception 'New end time must be later than the current scheduled end time.';
  end if;
  if v_booking.extension_status = 'pending' then
    raise exception 'There is already a pending extension request for this booking.';
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id;
  if not found then raise exception 'Resource not found.'; end if;

  select exists (
    select 1 from public.bookings b
     where b.resource_id = v_booking.resource_id
       and b.id <> v_booking.id
       and b.status in ('approved', 'in_use', 'return_pending')
       and b.start_time < p_new_end_time
       and b.end_time > v_booking.end_time
  ) into v_has_conflict;

  select p.primary_role into v_actor_role from public.profiles p where p.id = v_user_id;

  update public.bookings
     set extension_status = 'pending',
         extension_requested_end_time = p_new_end_time,
         extension_reason = v_clean_reason,
         extension_requested_at = now(),
         extension_decided_by = null,
         extension_decided_at = null,
         extension_decision_reason = null,
         updated_at = now()
   where id = v_booking.id;

  insert into public.activity_events (
    actor_id, actor_role_snapshot, entity_type, entity_id, action,
    previous_state, new_state, reason, metadata
  ) values (
    v_user_id, coalesce(v_actor_role, 'borrower'), 'booking', v_booking.id,
    'EXTENSION_REQUESTED', v_booking.end_time::text, p_new_end_time::text,
    v_clean_reason,
    jsonb_build_object('booking_id', v_booking.id, 'has_overlap_conflict', v_has_conflict,
                       'requested_end_time', p_new_end_time)
  );

  if v_resource.owner_id is not null then
    insert into public.notifications (
      recipient_id, type, related_entity_type, related_entity_id, message, dedupe_key
    ) values (
      v_resource.owner_id, 'general', 'booking', v_booking.id,
      'Extension requested for "' || v_resource.title || '" until ' ||
        to_char(p_new_end_time at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') || ' IST.',
      'extension_req_' || v_booking.id::text || '_' || floor(extract(epoch from now()))::bigint::text
    );
  end if;

  return jsonb_build_object(
    'success', true, 'extension_request_id', v_booking.id,
    'booking_id', v_booking.id, 'status', 'pending', 'has_conflict', v_has_conflict
  );
end;
$function$;

create or replace function public.decide_booking_extension(
  p_extension_request_id uuid,
  p_decision text,
  p_decision_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_resource public.resources%rowtype;
  v_actor_role text;
  v_clean_reason text := trim(coalesce(p_decision_reason, ''));
  v_conflict record;
  v_old_end timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required.'; end if;
  if coalesce(p_decision, '') not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;
  if p_decision = 'rejected' and length(v_clean_reason) < 3 then
    raise exception 'Rejection requires a documented reason.';
  end if;

  -- The legacy argument name is retained for API compatibility; its value is
  -- now the booking id, not an extension_requests row id.
  select * into v_booking from public.bookings where id = p_extension_request_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if v_booking.extension_status <> 'pending'
     or v_booking.extension_requested_end_time is null then
    raise exception 'No pending extension request exists for this booking.';
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id for update;
  if not found then raise exception 'Resource not found.'; end if;
  if v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: only the resource owner or campus staff can decide extensions.';
  end if;
  if v_booking.status not in ('approved', 'in_use') then
    raise exception 'The booking is no longer eligible for an extension decision.';
  end if;

  v_old_end := v_booking.end_time;
  select p.primary_role into v_actor_role from public.profiles p where p.id = v_user_id;

  if p_decision = 'approved' then
    select b.id, b.start_time, b.end_time into v_conflict
      from public.bookings b
     where b.resource_id = v_booking.resource_id
       and b.id <> v_booking.id
       and b.status in ('approved', 'in_use', 'return_pending')
       and b.start_time < v_booking.extension_requested_end_time
       and b.end_time > v_booking.end_time
     limit 1;
    if found then
      raise exception 'Extension blocked: it would overlap another approved or active booking.';
    end if;

    v_clean_reason := coalesce(nullif(v_clean_reason, ''), 'Extension approved by resource owner.');
    update public.bookings
       set end_time = extension_requested_end_time,
           extension_status = 'approved',
           extension_decided_by = v_user_id,
           extension_decided_at = now(),
           extension_decision_reason = v_clean_reason,
           updated_at = now()
     where id = v_booking.id;
  else
    update public.bookings
       set extension_status = 'rejected',
           extension_decided_by = v_user_id,
           extension_decided_at = now(),
           extension_decision_reason = v_clean_reason,
           updated_at = now()
     where id = v_booking.id;
  end if;

  insert into public.activity_events (
    actor_id, actor_role_snapshot, entity_type, entity_id, action,
    previous_state, new_state, reason, metadata
  ) values (
    v_user_id, coalesce(v_actor_role, 'owner'), 'booking', v_booking.id,
    case when p_decision = 'approved' then 'EXTENSION_APPROVED' else 'EXTENSION_REJECTED' end,
    v_old_end::text, case when p_decision = 'approved'
      then v_booking.extension_requested_end_time::text else v_booking.end_time::text end,
    v_clean_reason,
    jsonb_build_object('booking_id', v_booking.id,
                       'old_end_time', v_old_end,
                       'requested_end_time', v_booking.extension_requested_end_time,
                       'decision', p_decision)
  );

  insert into public.notifications (
    recipient_id, type, related_entity_type, related_entity_id, message, dedupe_key
  ) values (
    v_booking.requester_id,
    case when p_decision = 'approved' then 'approval' else 'rejection' end,
    'booking', v_booking.id,
    case when p_decision = 'approved'
      then 'Extension approved until ' || to_char(v_booking.extension_requested_end_time at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') || ' IST.'
      else 'Extension declined. Reason: ' || v_clean_reason end,
    'extension_decision_' || v_booking.id::text || '_' || floor(extract(epoch from now()))::bigint::text
  );

  return jsonb_build_object('success', true, 'extension_request_id', v_booking.id,
                            'booking_id', v_booking.id, 'decision', p_decision,
                            'reason', v_clean_reason);
end;
$function$;

revoke all on function public.request_booking_extension(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.request_booking_extension(uuid, timestamptz, text) to authenticated;
revoke all on function public.decide_booking_extension(uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_booking_extension(uuid, text, text) to authenticated;

-- All legacy rows were copied into booking fields and activity_events by 011.
-- The table is now unused by application code and is removed to enforce the
-- locked compatibility plan's single source of extension state.
drop table if exists public.extension_requests;
