-- ==============================================================================
-- CampusShare Booking Operations Migration: 002_booking_operations.sql
-- Description: Database functions for booking requests, approvals, rejections,
--              waitlisting, cancellations, extensions, eligibility checks,
--              active custody blocker, and fair-use limits.
-- Compatible with: Supabase SQL Editor & PostgreSQL 15+
-- ==============================================================================

-- ==============================================================================
-- 1. HELPER: CHECK BORROWER ELIGIBILITY
-- ==============================================================================
create or replace function public.check_borrower_eligibility(
  p_user_id uuid,
  p_resource_id uuid
)
returns table (
  is_eligible boolean,
  missing_reason text
) as $$
declare
  v_affiliation text;
  v_required_training text;
  v_has_training boolean;
begin
  -- 1. Check campus affiliation
  select campus_affiliation_status into v_affiliation
  from public.profiles
  where id = p_user_id;

  if v_affiliation is null or v_affiliation <> 'verified' then
    return query select false, 'Campus affiliation is not verified';
    return;
  end if;

  -- 2. Check required training qualification
  select required_training_code into v_required_training
  from public.resources
  where id = p_resource_id;

  if v_required_training is not null and v_required_training <> '' then
    select exists (
      select 1 from public.profile_qualifications
      where user_id = p_user_id
        and training_code = v_required_training
        and status = 'verified'
        and (expires_at is null or expires_at > now())
    ) into v_has_training;

    if not v_has_training then
      return query select false, 'Missing or expired required prerequisite: ' || v_required_training;
      return;
    end if;
  end if;

  return query select true, null::text;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ==============================================================================
-- 2. FUNCTION: SUBMIT BOOKING REQUEST
-- ==============================================================================
create or replace function public.submit_booking_request(
  p_resource_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_purpose text,
  p_group_id uuid default null,
  p_supervisor_user_id uuid default null
)
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_resource record;
  v_duration_hours numeric;
  v_open_items_count int;
  v_7d_uses_count int;
  v_group_open_count int;
  v_group_7d_count int;
  v_is_eligible boolean;
  v_missing_reason text;
  v_initial_status text;
  v_booking_id uuid;
  v_user_role text;
begin
  if v_user_id is null then
    raise exception 'Authentication required: User not signed in.';
  end if;

  if p_purpose is null or length(trim(p_purpose)) = 0 then
    raise exception 'Validation error: Booking purpose is mandatory.';
  end if;

  if p_end_time <= p_start_time then
    raise exception 'Validation error: End time must be strictly after start time.';
  end if;

  if p_start_time < (now() - interval '5 minutes') then
    raise exception 'Validation error: Start time cannot be in the past.';
  end if;

  -- Fetch resource details
  select * into v_resource
  from public.resources
  where id = p_resource_id;

  if not found then
    raise exception 'Not found: Resource does not exist.';
  end if;

  if v_resource.state <> 'published' then
    raise exception 'Unavailable: Resource is currently % and not accepting requests.', v_resource.state;
  end if;

  -- Validate maximum duration cap
  v_duration_hours := round(extract(epoch from (p_end_time - p_start_time)) / 3600.0, 2);
  if v_duration_hours > v_resource.max_duration_hours then
    raise exception 'Duration limit exceeded: Requested % hours exceeds maximum allowed limit of % hours.',
      v_duration_hours, v_resource.max_duration_hours;
  end if;

  -- Validate group membership if requesting as a project group
  if p_group_id is not null then
    if not exists (
      select 1 from public.project_groups
      where id = p_group_id and is_verified = true
    ) then
      raise exception 'Group verification error: Selected project group is not verified by campus management.';
    end if;

    if not exists (
      select 1 from public.group_members
      where group_id = p_group_id and user_id = v_user_id and status = 'approved'
    ) then
      raise exception 'Permission denied: You are not an approved member of this project group.';
    end if;

    -- Group Fair-Use Cap: Max 3 open group booking items
    select count(*) into v_group_open_count
    from public.bookings
    where group_id = p_group_id
      and status in ('pending_verification', 'pending_owner_review', 'waitlisted', 'approved')
      and actual_start_at is null;

    if v_group_open_count >= 3 then
      raise exception 'Fair-Use Cap: Project group has reached the limit of 3 concurrent open booking items.';
    end if;

    -- Group Fair-Use Cap: Max 5 group uses in rolling 7-day window
    select count(*) into v_group_7d_count
    from public.bookings
    where group_id = p_group_id
      and status in ('approved', 'in_use', 'return_pending', 'returned')
      and start_time >= (now() - interval '7 days');

    if v_group_7d_count >= 5 then
      raise exception 'Fair-Use Cap: Project group has reached the limit of 5 completed/approved uses in 7 days.';
    end if;
  end if;

  -- Individual Fair-Use Cap: Max 2 open booking items at once
  select count(*) into v_open_items_count
  from public.bookings
  where requester_id = v_user_id
    and status in ('pending_verification', 'pending_owner_review', 'waitlisted', 'approved')
    and actual_start_at is null;

  if v_open_items_count >= 2 then
    raise exception 'Fair-Use Cap: You already have 2 active open booking items. Please complete or cancel one before requesting another.';
  end if;

  -- Individual Fair-Use Cap: Max 3 approved uses in rolling 7-day window
  select count(*) into v_7d_uses_count
  from public.bookings
  where requester_id = v_user_id
    and status in ('approved', 'in_use', 'return_pending', 'returned')
    and start_time >= (now() - interval '7 days');

  if v_7d_uses_count >= 3 then
    raise exception 'Fair-Use Cap: You have reached the limit of 3 approved uses in a rolling 7-day window.';
  end if;

  -- Evaluate eligibility for training and affiliation
  select is_eligible, missing_reason
  into v_is_eligible, v_missing_reason
  from public.check_borrower_eligibility(v_user_id, p_resource_id);

  if not v_is_eligible then
    v_initial_status := 'pending_verification';
  else
    v_initial_status := 'pending_owner_review';
  end if;

  -- Insert booking record
  insert into public.bookings (
    resource_id,
    requester_id,
    group_id,
    start_time,
    end_time,
    purpose,
    status,
    supervisor_user_id,
    decision_reason
  ) values (
    p_resource_id,
    v_user_id,
    p_group_id,
    p_start_time,
    p_end_time,
    p_purpose,
    v_initial_status,
    p_supervisor_user_id,
    case when not v_is_eligible then v_missing_reason else null end
  ) returning id into v_booking_id;

  -- Get actor role snapshot
  select primary_role into v_user_role from public.profiles where id = v_user_id;

  -- Atomically write Trust Record audit event
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
    coalesce(v_user_role, 'borrower'),
    'booking',
    v_booking_id,
    'BOOKING_REQUESTED',
    null,
    v_initial_status,
    case when not v_is_eligible then v_missing_reason else 'New booking request submitted' end,
    jsonb_build_object(
      'resource_title', v_resource.title,
      'duration_hours', v_duration_hours,
      'start_time', p_start_time,
      'end_time', p_end_time,
      'is_eligible', v_is_eligible
    )
  );

  -- Atomically notify the resource owner
  insert into public.notifications (
    recipient_id,
    type,
    related_entity_type,
    related_entity_id,
    message,
    dedupe_key
  ) values (
    v_resource.owner_id,
    'general',
    'booking',
    v_booking_id,
    'New request for "' || v_resource.title || '" (' || v_initial_status || ').',
    'booking_submitted_' || v_booking_id::text
  );

  return jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'status', v_initial_status,
    'is_eligible', v_is_eligible,
    'eligibility_note', v_missing_reason
  );
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 3. FUNCTION: APPROVE BOOKING REQUEST
-- ==============================================================================
create or replace function public.approve_booking_request(
  p_booking_id uuid,
  p_decision_reason text default null,
  p_supervisor_user_id uuid default null
)
returns jsonb as $$
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
  where id = p_booking_id;

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
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 4. FUNCTION: REJECT BOOKING REQUEST
-- ==============================================================================
create or replace function public.reject_booking_request(
  p_booking_id uuid,
  p_decision_reason text
)
returns jsonb as $$
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

  select * into v_booking from public.bookings where id = p_booking_id;
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
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 5. FUNCTION: WAITLIST BOOKING REQUEST (FIFO)
-- ==============================================================================
create or replace function public.waitlist_booking_request(
  p_booking_id uuid,
  p_decision_reason text
)
returns jsonb as $$
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
  if length(v_clean_reason) = 0 then
    raise exception 'Waitlisting requires a documented reason (e.g., slot contention, high demand).';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Booking not found.';
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id;

  -- Requester themselves, owner, or manager can place on waitlist
  if v_booking.requester_id <> v_user_id and v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied.';
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
    and created_at <= v_booking.created_at;

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
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 6. FUNCTION: CANCEL BOOKING WITH REASON
-- ==============================================================================
create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_reason text
)
returns jsonb as $$
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

  select * into v_booking from public.bookings where id = p_booking_id;
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
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 7. FUNCTION: REQUEST BOOKING EXTENSION
-- ==============================================================================
create or replace function public.request_booking_extension(
  p_booking_id uuid,
  p_new_end_time timestamptz,
  p_reason text
)
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_booking record;
  v_resource record;
  v_clean_reason text;
  v_extension_id uuid;
  v_conflicting record;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  v_clean_reason := trim(coalesce(p_reason, ''));
  if length(v_clean_reason) = 0 then
    raise exception 'Extension requires a documented justification.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.requester_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only the borrower can request an extension.';
  end if;

  if v_booking.status not in ('approved', 'in_use') then
    raise exception 'Invalid status: Can only extend approved or in-use reservations.';
  end if;

  if p_new_end_time <= v_booking.end_time then
    raise exception 'Validation error: New end time must be later than current scheduled end time.';
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id;

  -- Check for existing pending extension request on this booking
  if exists (
    select 1 from public.extension_requests
    where booking_id = p_booking_id and status = 'pending'
  ) then
    raise exception 'Duplicate: There is already a pending extension request for this booking.';
  end if;

  -- Preliminary conflict detection
  select id, start_time, end_time into v_conflicting
  from public.bookings
  where resource_id = v_booking.resource_id
    and id <> p_booking_id
    and status in ('approved', 'in_use', 'return_pending')
    and start_time < p_new_end_time
    and end_time > v_booking.end_time
  limit 1;

  -- Create extension request record
  insert into public.extension_requests (
    booking_id,
    requested_by,
    new_end_time,
    reason,
    status
  ) values (
    p_booking_id,
    v_user_id,
    p_new_end_time,
    v_clean_reason,
    'pending'
  ) returning id into v_extension_id;

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
    'borrower',
    'extension_request',
    v_extension_id,
    'EXTENSION_REQUESTED',
    'pending',
    'pending',
    v_clean_reason,
    jsonb_build_object(
      'current_end_time', v_booking.end_time,
      'requested_new_end_time', p_new_end_time,
      'has_overlap_conflict', found
    )
  );

  -- Notify resource owner
  insert into public.notifications (
    recipient_id,
    type,
    related_entity_type,
    related_entity_id,
    message,
    dedupe_key
  ) values (
    v_resource.owner_id,
    'general',
    'extension_request',
    v_extension_id,
    'Extension requested for "' || v_resource.title || '" until ' || p_new_end_time::text,
    'extension_req_' || v_extension_id::text
  );

  return jsonb_build_object(
    'success', true,
    'extension_request_id', v_extension_id,
    'status', 'pending',
    'has_conflict', found
  );
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 8. FUNCTION: DECIDE BOOKING EXTENSION
-- ==============================================================================
create or replace function public.decide_booking_extension(
  p_extension_request_id uuid,
  p_decision text,
  p_decision_reason text default null
)
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_ext record;
  v_booking record;
  v_resource record;
  v_actor_role text;
  v_clean_reason text;
  v_conflict record;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision: Must be approved or rejected.';
  end if;

  select * into v_ext
  from public.extension_requests
  where id = p_extension_request_id;

  if not found then
    raise exception 'Extension request not found.';
  end if;

  if v_ext.status <> 'pending' then
    raise exception 'Extension request has already been decided (%).', v_ext.status;
  end if;

  select * into v_booking from public.bookings where id = v_ext.booking_id;
  select * into v_resource from public.resources where id = v_booking.resource_id for update;

  -- Permission: Owner, manager, or admin
  if v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only the owner or campus manager can decide extension requests.';
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  if p_decision = 'approved' then
    -- Re-check schedule overlap
    select id, start_time, end_time into v_conflict
    from public.bookings
    where resource_id = v_booking.resource_id
      and id <> v_booking.id
      and status in ('approved', 'in_use', 'return_pending')
      and start_time < v_ext.new_end_time
      and end_time > v_booking.end_time
    limit 1;

    if found then
      raise exception 'Extension blocked: Extension would overlap with existing approved booking (#%) starting at %.',
        v_conflict.id, v_conflict.start_time;
    end if;

    v_clean_reason := coalesce(trim(p_decision_reason), 'Owner approved booking extension.');

    -- Update booking end_time
    update public.bookings
    set end_time = v_ext.new_end_time,
        updated_at = now()
    where id = v_booking.id;

    -- Update extension request
    update public.extension_requests
    set status = 'approved',
        decided_by = v_user_id,
        decision_reason = v_clean_reason,
        decided_at = now()
    where id = p_extension_request_id;

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
      'extension_request',
      p_extension_request_id,
      'EXTENSION_APPROVED',
      'pending',
      'approved',
      v_clean_reason,
      jsonb_build_object(
        'booking_id', v_booking.id,
        'old_end_time', v_booking.end_time,
        'new_end_time', v_ext.new_end_time
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
      'approval',
      'booking',
      v_booking.id,
      'Extension approved for "' || v_resource.title || '" until ' || v_ext.new_end_time::text,
      'ext_decision_' || p_extension_request_id::text
    );

  else
    -- Rejected
    v_clean_reason := coalesce(trim(p_decision_reason), 'Extension declined by resource owner.');

    update public.extension_requests
    set status = 'rejected',
        decided_by = v_user_id,
        decision_reason = v_clean_reason,
        decided_at = now()
    where id = p_extension_request_id;

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
      'extension_request',
      p_extension_request_id,
      'EXTENSION_REJECTED',
      'pending',
      'rejected',
      v_clean_reason,
      jsonb_build_object('booking_id', v_booking.id)
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
      'rejection',
      'booking',
      v_booking.id,
      'Extension declined for "' || v_resource.title || '". Reason: ' || v_clean_reason,
      'ext_decision_' || p_extension_request_id::text
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'extension_request_id', p_extension_request_id,
    'decision', p_decision,
    'reason', v_clean_reason
  );
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 9. PERMISSIONS: REVOKE PUBLIC, GRANT TO AUTHENTICATED
-- ==============================================================================
revoke execute on function public.check_borrower_eligibility(uuid, uuid) from public;
revoke execute on function public.submit_booking_request(uuid, timestamptz, timestamptz, text, uuid, uuid) from public;
revoke execute on function public.approve_booking_request(uuid, text, uuid) from public;
revoke execute on function public.reject_booking_request(uuid, text) from public;
revoke execute on function public.waitlist_booking_request(uuid, text) from public;
revoke execute on function public.cancel_booking(uuid, text) from public;
revoke execute on function public.request_booking_extension(uuid, timestamptz, text) from public;
revoke execute on function public.decide_booking_extension(uuid, text, text) from public;

grant execute on function public.check_borrower_eligibility(uuid, uuid) to authenticated;
grant execute on function public.submit_booking_request(uuid, timestamptz, timestamptz, text, uuid, uuid) to authenticated;
grant execute on function public.approve_booking_request(uuid, text, uuid) to authenticated;
grant execute on function public.reject_booking_request(uuid, text) to authenticated;
grant execute on function public.waitlist_booking_request(uuid, text) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.request_booking_extension(uuid, timestamptz, text) to authenticated;
grant execute on function public.decide_booking_extension(uuid, text, text) to authenticated;
