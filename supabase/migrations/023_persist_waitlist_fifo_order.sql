-- CampusShare migration 023: persist queue-entry time and keep FIFO position stable.
alter table public.bookings
  add column if not exists waitlisted_at timestamptz;

update public.bookings b
set waitlisted_at = coalesce(
  (select min(e.created_at)
     from public.activity_events e
    where e.entity_type = 'booking'
      and e.entity_id = b.id
      and e.action = 'BOOKING_WAITLISTED'),
  b.created_at
)
where b.status = 'waitlisted' and b.waitlisted_at is null;

update public.bookings
set waitlisted_at = null
where status <> 'waitlisted' and waitlisted_at is not null;

create index if not exists bookings_resource_waitlisted_at_idx
  on public.bookings(resource_id, waitlisted_at, id)
  where status = 'waitlisted';

alter table public.bookings
  add constraint bookings_waitlisted_at_consistent
  check ((status = 'waitlisted') = (waitlisted_at is not null)) not valid;
alter table public.bookings
  validate constraint bookings_waitlisted_at_consistent;

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
  v_waitlisted_at timestamptz;
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

  v_waitlisted_at := clock_timestamp();

  update public.bookings
  set status = 'waitlisted',
      waitlisted_at = v_waitlisted_at,
      decision_reason = v_clean_reason,
      updated_at = now()
  where id = p_booking_id;

  -- Calculate FIFO position for this resource
  select count(*) + 1 into v_queue_position
  from public.bookings
  where resource_id = v_booking.resource_id
    and status = 'waitlisted'
    and id <> p_booking_id
    and (
      waitlisted_at < v_waitlisted_at
      or (waitlisted_at = v_waitlisted_at and id < p_booking_id)
    );

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

CREATE OR REPLACE FUNCTION public.approve_booking_request(p_booking_id uuid, p_decision_reason text DEFAULT NULL::text, p_supervisor_user_id uuid DEFAULT NULL::uuid)
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
  v_is_eligible boolean;
  v_missing_reason text;
  v_active_custody_conflict record;
  v_overlapping_conflict record;
  v_final_reason text;
  v_supervisor_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found.';
  end if;

  select * into v_resource
  from public.resources
  where id = v_booking.resource_id
  for update;

  select primary_role into v_actor_role
  from public.profiles
  where id = v_user_id;

  -- Authorization check: Caller must be resource owner, manager, or admin
  if v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only the designated owner or an authorized manager can approve requests.';
  end if;

  -- Allowed initial states for approval
  if v_booking.status not in ('pending_owner_review', 'waitlisted', 'pending_verification') then
    raise exception 'Invalid transition: Cannot approve a booking currently in status %.', v_booking.status;
  end if;

  -- RECHECK 1: Eligibility check at approval time
  select is_eligible, missing_reason
  into v_is_eligible, v_missing_reason
  from public.check_borrower_eligibility(v_booking.requester_id, v_booking.resource_id);

  if not v_is_eligible then
    raise exception 'Approval blocked by eligibility gate: %', v_missing_reason;
  end if;

  -- RECHECK 2: Supervision gate
  v_supervisor_id := coalesce(p_supervisor_user_id, v_booking.supervisor_user_id);
  if v_resource.requires_supervision and v_supervisor_id is null then
    raise exception 'Supervision required: Resource requires an authorized supervisor assigned prior to approval.';
  end if;

  -- RECHECK 3: Active physical custody blocker
  -- If any item is currently In Use or Return Pending without confirmed return,
  -- block new approvals regardless of the requested slot.
  select b.id, b.status, b.requester_id, b.end_time into v_active_custody_conflict
  from public.bookings b
  where b.resource_id = v_booking.resource_id
    and b.id <> v_booking.id
    and b.status in ('in_use', 'return_pending')
    and b.actual_release_confirmed_at is null
  limit 1;

  if found then
    raise exception 'Active custody blocker: Resource has an active custody session (#%) that has not confirmed hand-back. New approvals remain blocked until physical custody is confirmed returned.',
      v_active_custody_conflict.id;
  end if;

  -- RECHECK 4: Database-enforced scheduled interval overlap (half-open [start, end))
  select b.id, b.start_time, b.end_time into v_overlapping_conflict
  from public.bookings b
  where b.resource_id = v_booking.resource_id
    and b.id <> v_booking.id
    and b.status in ('approved', 'in_use', 'return_pending')
    and b.start_time < v_booking.end_time
    and b.end_time > v_booking.start_time
  limit 1;

  if found then
    raise exception 'Scheduling conflict: Time slot overlaps with an approved booking (#%) from % to % IST.',
      v_overlapping_conflict.id, v_overlapping_conflict.start_time, v_overlapping_conflict.end_time;
  end if;

  -- Decision reason formulation
  v_final_reason := coalesce(
    trim(p_decision_reason),
    'Eligibility verified, slot confirmed conflict-free, and owner approved.'
  );

  -- Update booking state
  update public.bookings
  set status = 'approved',
      waitlisted_at = null,
      supervisor_user_id = v_supervisor_id,
      decision_reason = v_final_reason,
      updated_at = now()
  where id = p_booking_id;

  -- Atomic Trust Record event
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
    'BOOKING_APPROVED',
    v_booking.status,
    'approved',
    v_final_reason,
    jsonb_build_object(
      'resource_title', v_resource.title,
      'supervisor_user_id', v_supervisor_id,
      'approved_by', v_user_id
    )
  );

  -- Atomic In-app notification to borrower
  insert into public.notifications (
    recipient_id,
    type,
    related_entity_type,
    related_entity_id,
    message,
    dedupe_key
  ) values (
    v_booking.requester_id,
    'approval',
    'booking',
    p_booking_id,
    'Your reservation for "' || v_resource.title || '" was approved. Reason: ' || v_final_reason,
    'booking_approved_' || p_booking_id::text
  );

  return jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'approved',
    'decision_reason', v_final_reason
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.reject_booking_request(p_booking_id uuid, p_decision_reason text)
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
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  v_clean_reason := trim(coalesce(p_decision_reason, ''));
  if length(v_clean_reason) = 0 then
    raise exception 'Accountability rule: Rejection requires a mandatory human-readable reason.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id
  for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id;

  if v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only the owner or campus manager can reject this request.';
  end if;

  if v_booking.status not in ('pending_verification', 'pending_owner_review', 'waitlisted') then
    raise exception 'Invalid transition: Cannot reject a booking in status %.', v_booking.status;
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  update public.bookings
  set status = 'rejected',
      waitlisted_at = null,
      decision_reason = v_clean_reason,
      updated_at = now()
  where id = p_booking_id;

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
    'BOOKING_REJECTED',
    v_booking.status,
    'rejected',
    v_clean_reason,
    jsonb_build_object('resource_title', v_resource.title)
  );

  -- In-app notification to borrower
  insert into public.notifications (
    recipient_id,
    type,
    related_entity_type,
    related_entity_id,
    message,
    dedupe_key
  ) values (
    v_booking.requester_id,
    'rejection',
    'booking',
    p_booking_id,
    'Your booking request for "' || v_resource.title || '" was declined. Reason: ' || v_clean_reason,
    'booking_rejected_' || p_booking_id::text
  );

  return jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'rejected',
    'reason', v_clean_reason
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason text)
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
  v_recipient_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  v_clean_reason := trim(coalesce(p_reason, ''));
  if length(v_clean_reason) = 0 then
    raise exception 'Cancellation requires an explicit reason.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id
  for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id;

  -- Only requester, owner, or manager/admin can cancel
  if v_booking.requester_id <> v_user_id and v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied.';
  end if;

  -- Life-cycle rule: cannot cancel once in active custody (must perform return or report incident)
  if v_booking.status in ('in_use', 'return_pending') then
    raise exception 'Active custody rule: Cannot cancel an in-use or return-pending booking. Complete hand-back or report an incident.';
  end if;

  if v_booking.status in ('returned', 'cancelled', 'rejected') then
    raise exception 'Booking is already in a terminal status (%).', v_booking.status;
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  update public.bookings
  set status = 'cancelled',
      waitlisted_at = null,
      decision_reason = v_clean_reason,
      updated_at = now()
  where id = p_booking_id;

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
    coalesce(v_actor_role, 'borrower'),
    'booking',
    p_booking_id,
    'BOOKING_CANCELLED',
    v_booking.status,
    'cancelled',
    v_clean_reason,
    jsonb_build_object('resource_title', v_resource.title)
  );

  -- Notify other party
  v_recipient_id := case when v_user_id = v_booking.requester_id then v_resource.owner_id else v_booking.requester_id end;

  insert into public.notifications (
    recipient_id,
    type,
    related_entity_type,
    related_entity_id,
    message,
    dedupe_key
  ) values (
    v_recipient_id,
    'general',
    'booking',
    p_booking_id,
    'Booking for "' || v_resource.title || '" was cancelled. Reason: ' || v_clean_reason,
    'booking_cancelled_' || p_booking_id::text
  );

  return jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'cancelled'
  );
end;
$function$;

comment on column public.bookings.waitlisted_at is
  'Timestamp the booking entered the waitlist; FIFO positions are ordered by this timestamp, with booking id as a deterministic tie-breaker.';
comment on function public.waitlist_booking_request(uuid, text) is
  'Waitlisting is a documented owner/staff decision. The queue-entry timestamp is persisted and FIFO positions are stable by waitlisted_at then booking id.';
