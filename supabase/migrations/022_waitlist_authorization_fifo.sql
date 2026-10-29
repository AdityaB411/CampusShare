-- CampusShare migration 022: enforce custodian-only waitlisting and deterministic FIFO queue positions.
CREATE OR REPLACE FUNCTION public.waitlist_booking_request(p_booking_id uuid, p_decision_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_booking record;
  v_resource record;
  v_actor_role text;
  v_clean_reason text;
  v_queue_position int;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  v_clean_reason := trim(coalesce(p_decision_reason, ''));
  if length(v_clean_reason) < 3 or length(v_clean_reason) > 2000 then
    raise exception 'Waitlisting requires a documented reason between 3 and 2000 characters.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id for update;

  -- Waitlisting is a custodian/staff decision, never a borrower self-service action.
  if v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only the resource owner or campus staff can waitlist a booking.';
  end if;
  if not public.is_admin_or_manager() and not public.is_verified_owner() then
    raise exception 'Permission denied: Resource owner verification is required.';
  end if;

  if v_booking.status not in ('pending_owner_review', 'pending_verification') then
    raise exception 'Invalid transition: Cannot waitlist a booking in status %.', v_booking.status;
  end if;

  update public.bookings
  set status = 'waitlisted',
      decision_reason = v_clean_reason,
      updated_at = now()
  where id = p_booking_id;

  -- Calculate FIFO position for this resource
  select count(*) into v_queue_position
  from public.bookings
  where resource_id = v_booking.resource_id
    and status = 'waitlisted'
    and (created_at < v_booking.created_at or (created_at = v_booking.created_at and id <= v_booking.id));

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  -- Trust Record entry
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
    'booking',
    p_booking_id,
    'BOOKING_WAITLISTED',
    v_booking.status,
    'waitlisted',
    v_clean_reason,
    jsonb_build_object(
      'resource_title', v_resource.title,
      'queue_position', v_queue_position
    )
  );

  -- Notification
  insert into public.notifications (
    recipient_id,
    type,
    related_entity_type,
    related_entity_id,
    message,
    dedupe_key
  ) values (
    v_booking.requester_id,
    'general',
    'booking',
    p_booking_id,
    'Your request for "' || v_resource.title || '" is waitlisted (Queue Position #' || v_queue_position || '). Reason: ' || v_clean_reason,
    'booking_waitlist_' || p_booking_id::text
  );

  return jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'waitlisted',
    'queue_position', v_queue_position
  );
end;
$function$;
comment on function public.waitlist_booking_request(uuid, text) is
  'Waitlisting is a documented owner/staff decision, guarded by owner verification, serialized booking/resource locks, and deterministic FIFO ordering including timestamp ties.';
