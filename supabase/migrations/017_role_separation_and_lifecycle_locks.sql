-- CampusShare migration 017: keep role verification separate from role assignment and serialize lifecycle mutations.
CREATE OR REPLACE FUNCTION public.verify_user_status(p_target_user_id uuid, p_affiliation_status text DEFAULT NULL::text, p_owner_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_caller_id uuid := auth.uid();
  v_target record;
  v_caller_role text;
begin
  if v_caller_id is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only campus managers and administrators can verify users.';
  end if;

  select * into v_target from public.profiles where id = p_target_user_id for update;
  if not found then
    raise exception 'Target user profile not found.';
  end if;

  select primary_role into v_caller_role from public.profiles where id = v_caller_id;

  -- Validate inputs if provided
  if p_affiliation_status is not null and p_affiliation_status not in ('verified', 'pending', 'unverified') then
    raise exception 'Validation error: Invalid affiliation status.';
  end if;

  if p_owner_status is not null and p_owner_status not in ('verified', 'pending', 'unverified') then
    raise exception 'Validation error: Invalid owner verification status.';
  end if;

  -- Verification updates status only. Role assignment is a separate administrator-only action.
  update public.profiles
  set campus_affiliation_status = coalesce(p_affiliation_status, campus_affiliation_status),
      owner_verification_status = coalesce(p_owner_status, owner_verification_status),
      verifier_user_id = v_caller_id,
      updated_at = now()
  where id = p_target_user_id;

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
    v_caller_id,
    v_caller_role,
    'profile',
    p_target_user_id,
    'USER_STATUS_VERIFIED',
    jsonb_build_object(
      'affiliation', v_target.campus_affiliation_status,
      'owner_status', v_target.owner_verification_status,
      'role', v_target.primary_role
    )::text,
    jsonb_build_object(
      'affiliation', coalesce(p_affiliation_status, v_target.campus_affiliation_status),
      'owner_status', coalesce(p_owner_status, v_target.owner_verification_status),
      'role', v_target.primary_role
    )::text,
    'Authorized verification decision by campus management.',
    jsonb_build_object(
      'verifier_id', v_caller_id,
      'target_name', v_target.display_name
    )
  );

  -- Notify user
  insert into public.notifications (
    recipient_id,
    type,
    related_entity_type,
    related_entity_id,
    message,
    dedupe_key
  ) values (
    p_target_user_id,
    'general',
    'profile',
    p_target_user_id,
    'Your campus status has been updated: Affiliation=' || coalesce(p_affiliation_status, v_target.campus_affiliation_status) || ', Owner Status=' || coalesce(p_owner_status, v_target.owner_verification_status),
    'user_verified_' || p_target_user_id::text || '_' || extract(epoch from now())::text
  );

  return jsonb_build_object(
    'success', true,
    'target_user_id', p_target_user_id,
    'affiliation_status', coalesce(p_affiliation_status, v_target.campus_affiliation_status),
    'owner_status', coalesce(p_owner_status, v_target.owner_verification_status),
    'primary_role', v_target.primary_role
  );
end;
$function$

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
  where id = p_booking_id;
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
$function$

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

  select * into v_booking from public.bookings where id = p_booking_id;
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
$function$

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

  select * into v_booking from public.bookings where id = p_booking_id;
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
$function$

CREATE OR REPLACE FUNCTION public.confirm_return(p_booking_id uuid, p_confirmation_notes text DEFAULT NULL::text, p_discrepancy_reported boolean DEFAULT false)
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
  v_incident_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  -- Can confirm return from return_pending or directly from in_use
  if v_booking.status not in ('return_pending', 'in_use') then
    raise exception 'Invalid transition: Cannot confirm return for booking in status %.', v_booking.status;
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id;

  -- Permission: Only owner, manager, or admin
  if v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only the designated resource owner or manager can confirm return.';
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  -- Terminal update: Hand-back confirmed, resource released
  update public.bookings
  set status = 'returned',
      actual_release_confirmed_at = now(),
      return_acknowledged_by = v_user_id,
      return_acknowledged_at = now(),
      updated_at = now()
  where id = p_booking_id;

  -- Update condition report acknowledgment
  update public.condition_reports
  set acknowledged_by = v_user_id
  where booking_id = p_booking_id and phase = 'end';

  -- If custodian notes a condition discrepancy upon inspection
  if p_discrepancy_reported then
    insert into public.incidents (
      booking_id,
      resource_id,
      type,
      description,
      status,
      reporter_id
    ) values (
      p_booking_id,
      v_resource.id,
      'custody_mismatch',
      'Custodian reported discrepancy upon hand-back inspection: ' || coalesce(p_confirmation_notes, 'Condition discrepancy noted.'),
      'open',
      v_user_id
    ) returning id into v_incident_id;
  end if;

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
    'RETURN_CONFIRMED',
    v_booking.status,
    'returned',
    coalesce(p_confirmation_notes, 'Custodian confirmed physical hand-back; resource released.'),
    jsonb_build_object(
      'resource_title', v_resource.title,
      'discrepancy_reported', p_discrepancy_reported,
      'incident_id', v_incident_id
    )
  );

  -- Notification to borrower confirming completion of custody
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
    'Return confirmed for "' || v_resource.title || '". Custody successfully closed.',
    'return_confirmed_' || p_booking_id::text
  );

  return jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'returned',
    'discrepancy_incident_id', v_incident_id
  );
end;
$function$

CREATE OR REPLACE FUNCTION public.submit_return(p_booking_id uuid, p_condition_code text, p_checklist jsonb DEFAULT '{}'::jsonb, p_notes text DEFAULT NULL::text)
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
  v_clean_condition text;
  v_condition_worsened boolean := false;
  v_incident_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  v_clean_condition := lower(trim(coalesce(p_condition_code, '')));
  if v_clean_condition not in ('good', 'fair', 'damaged', 'missing_parts') then
    raise exception 'Validation error: Return condition code must be good, fair, damaged, or missing_parts.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.status <> 'in_use' then
    raise exception 'Invalid transition: Cannot submit return for booking in status %.', v_booking.status;
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id;

  -- Caller must be borrower, custodian, or manager
  if v_booking.requester_id <> v_user_id 
     and v_resource.owner_id <> v_user_id 
     and not public.is_admin_or_manager() then
    raise exception 'Permission denied.';
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  -- Evaluate if condition worsened from start
  if v_clean_condition in ('damaged', 'missing_parts') then
    v_condition_worsened := true;
  elsif v_clean_condition = 'fair' and v_booking.initial_condition_code = 'good' then
    v_condition_worsened := true;
  end if;

  -- Update booking to return_pending
  update public.bookings
  set status = 'return_pending',
      return_condition_code = v_clean_condition,
      return_condition_checklist = coalesce(p_checklist, '{}'::jsonb),
      return_condition_notes = p_notes,
      updated_at = now()
  where id = p_booking_id;

  -- Record condition report
  insert into public.condition_reports (
    booking_id,
    phase,
    condition_code,
    checklist,
    notes,
    reporter_id
  ) values (
    p_booking_id,
    'end',
    v_clean_condition,
    coalesce(p_checklist, '{}'::jsonb),
    p_notes,
    v_user_id
  );

  -- If condition worsened, open an incident for human review
  -- NOTE: Strictly NO automated penalties or bans; requires human coordinator review
  if v_condition_worsened then
    insert into public.incidents (
      booking_id,
      resource_id,
      type,
      description,
      status,
      reporter_id
    ) values (
      p_booking_id,
      v_resource.id,
      'damage',
      'End condition reported as ' || v_clean_condition || ' (baseline was ' || coalesce(v_booking.initial_condition_code, 'unrecorded') || '). Notes: ' || coalesce(p_notes, 'None provided.'),
      'open',
      v_user_id
    ) returning id into v_incident_id;
  end if;

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
    'RETURN_SUBMITTED',
    'in_use',
    'return_pending',
    'Borrower submitted final return condition; awaiting custodian hand-back confirmation.',
    jsonb_build_object(
      'resource_title', v_resource.title,
      'return_condition', v_clean_condition,
      'condition_worsened', v_condition_worsened,
      'incident_opened_id', v_incident_id
    )
  );

  -- Notify owner to confirm hand-back
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
    p_booking_id,
    'Return submitted for "' || v_resource.title || '". Condition: ' || v_clean_condition || '. Please confirm hand-back.',
    'return_submitted_' || p_booking_id::text
  );

  return jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'return_pending',
    'condition_worsened', v_condition_worsened,
    'incident_id', v_incident_id
  );
end;
$function$

CREATE OR REPLACE FUNCTION public.resolve_incident(p_incident_id uuid, p_status text, p_resolution_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_incident record;
  v_resource record;
  v_clean_status text;
  v_clean_note text;
  v_actor_role text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  v_clean_status := lower(trim(coalesce(p_status, '')));
  if v_clean_status not in ('investigating', 'resolved') then
    raise exception 'Validation error: Incident status must be investigating or resolved.';
  end if;

  v_clean_note := trim(coalesce(p_resolution_note, ''));
  if length(v_clean_note) = 0 then
    raise exception 'Accountability rule: Reviewing or resolving an incident requires an explicit human resolution note.';
  end if;

  select * into v_incident from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'Incident not found.';
  end if;

  select * into v_resource from public.resources where id = v_incident.resource_id;

  -- Permission: Only resource owner, manager, or admin
  if v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only an authorized owner, manager, or admin can review incidents.';
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  -- Update incident status
  update public.incidents
  set status = v_clean_status,
      reviewer_id = v_user_id,
      resolution_note = v_clean_note,
      resolved_at = case when v_clean_status = 'resolved' then now() else null end
  where id = p_incident_id;

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
    coalesce(v_actor_role, 'manager'),
    'incident',
    p_incident_id,
    case when v_clean_status = 'resolved' then 'INCIDENT_RESOLVED' else 'INCIDENT_INVESTIGATING' end,
    v_incident.status,
    v_clean_status,
    v_clean_note,
    jsonb_build_object(
      'reviewer_id', v_user_id,
      'resource_title', v_resource.title
    )
  );

  -- Notify incident reporter
  insert into public.notifications (
    recipient_id,
    type,
    related_entity_type,
    related_entity_id,
    message,
    dedupe_key
  ) values (
    v_incident.reporter_id,
    'incident',
    'incident',
    p_incident_id,
    'Incident #' || p_incident_id::text || ' updated to ' || v_clean_status || '. Note: ' || v_clean_note,
    'incident_res_' || p_incident_id::text || '_' || v_clean_status
  );

  return jsonb_build_object(
    'success', true,
    'incident_id', p_incident_id,
    'status', v_clean_status,
    'resolution_note', v_clean_note
  );
end;
$function$

CREATE OR REPLACE FUNCTION public.verify_qualification(p_qualification_id uuid, p_status text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_caller_id uuid := auth.uid();
  v_qual record;
  v_clean_status text;
begin
  if v_caller_id is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only managers and administrators can verify qualifications.';
  end if;

  v_clean_status := lower(trim(coalesce(p_status, '')));
  if v_clean_status not in ('verified', 'pending', 'expired', 'revoked') then
    raise exception 'Validation error: Status must be verified, pending, expired, or revoked.';
  end if;

  select * into v_qual from public.profile_qualifications where id = p_qualification_id for update;
  if not found then
    raise exception 'Qualification record not found.';
  end if;

  update public.profile_qualifications
  set status = v_clean_status,
      expires_at = coalesce(p_expires_at, expires_at),
      verified_by = v_caller_id,
      verified_at = now()
  where id = p_qualification_id;

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
    v_caller_id,
    'manager',
    'qualification',
    p_qualification_id,
    'QUALIFICATION_VERIFIED',
    v_qual.status,
    v_clean_status,
    'Training credential verified by campus management.',
    jsonb_build_object(
      'training_code', v_qual.training_code,
      'user_id', v_qual.user_id,
      'expires_at', coalesce(p_expires_at, v_qual.expires_at)
    )
  );

  -- Notify user
  insert into public.notifications (
    recipient_id,
    type,
    related_entity_type,
    related_entity_id,
    message,
    dedupe_key
  ) values (
    v_qual.user_id,
    'general',
    'qualification',
    p_qualification_id,
    'Your training qualification "' || v_qual.training_code || '" was updated to: ' || v_clean_status,
    'qual_decision_' || p_qualification_id::text
  );

  return jsonb_build_object(
    'success', true,
    'qualification_id', p_qualification_id,
    'status', v_clean_status
  );
end;
$function$

CREATE OR REPLACE FUNCTION public.decide_group_membership(p_member_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_member record;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only managers or admins can decide group memberships.';
  end if;

  if p_status not in ('approved', 'pending', 'removed') then
    raise exception 'Invalid status: %', p_status;
  end if;

  select * into v_member from public.group_members where id = p_member_id for update;
  if not found then
    raise exception 'Group membership record not found.';
  end if;

  update public.group_members
  set status = p_status,
      approved_by = v_user_id
  where id = p_member_id;

  return jsonb_build_object('success', true, 'member_id', p_member_id, 'status', p_status);
end;
$function$

CREATE OR REPLACE FUNCTION public.submit_booking_request(p_resource_id uuid, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_purpose text, p_group_id uuid DEFAULT NULL::uuid, p_supervisor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  if p_start_time is null or p_end_time is null then
    raise exception 'Validation error: Start and end times are required.';
  end if;
  if length(trim(coalesce(p_purpose, ''))) > 1000 then
    raise exception 'Validation error: Booking purpose must not exceed 1000 characters.';
  end if;

  -- Serialize cap checks for the same borrower and, for group bookings, the same group.
  perform pg_advisory_xact_lock(hashtextextended('campusshare:user:' || v_user_id::text, 0));
  if p_group_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('campusshare:group:' || p_group_id::text, 0));
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
  where id = p_resource_id
  for share;

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
$function$

comment on function public.verify_user_status(uuid, text, text) is
  'Campus affiliation and owner verification only. Primary role changes are handled exclusively by the administrator-only assign_user_role RPC.';
comment on function public.submit_booking_request(uuid, timestamptz, timestamptz, text, uuid, uuid) is
  'Serializes borrower and group fair-use checks with transaction advisory locks and shares the resource row against concurrent state changes.';
