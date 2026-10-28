-- ==============================================================================
-- CampusShare Migration 003: 003_handoff_return_incidents.sql
-- Description: Functions for initial handoff checkout, return submission,
--              custodian hand-back confirmation, incident reporting, and
--              human review/resolution.
-- Compatible with: Supabase SQL Editor & PostgreSQL 15+
-- ==============================================================================

-- ==============================================================================
-- 1. FUNCTION: CONFIRM CHECK-OUT (START HANDOFF)
-- ==============================================================================
create or replace function public.confirm_checkout(
  p_booking_id uuid,
  p_condition_code text,
  p_checklist jsonb default '{}'::jsonb,
  p_notes text default null,
  p_supervisor_confirmation boolean default false
)
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_booking record;
  v_resource record;
  v_actor_role text;
  v_clean_condition text;
  v_is_supervisor_confirmed boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  v_clean_condition := lower(trim(coalesce(p_condition_code, '')));
  if v_clean_condition not in ('good', 'fair', 'damaged', 'missing_parts') then
    raise exception 'Validation error: Initial condition code must be good, fair, damaged, or missing_parts.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.status <> 'approved' then
    raise exception 'Invalid transition: Only approved bookings can complete checkout (current status: %).', v_booking.status;
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id;
  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  -- Caller must be borrower, resource owner, assigned supervisor, or manager
  if v_booking.requester_id <> v_user_id
     and v_resource.owner_id <> v_user_id
     and coalesce(v_booking.supervisor_user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_user_id
     and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Caller is not a participant in this booking.';
  end if;

  -- Supervision check: If resource requires supervision, verify supervisor confirmation
  if v_resource.requires_supervision then
    if v_booking.supervisor_user_id is null then
      raise exception 'Supervision gate: Supervised resource cannot check out without an assigned supervisor.';
    end if;

    -- If caller is the supervisor or owner, or explicit supervisor confirmation flag provided
    if v_user_id = v_booking.supervisor_user_id
       or v_user_id = v_resource.owner_id
       or public.is_admin_or_manager()
       or p_supervisor_confirmation = true then
      v_is_supervisor_confirmed := true;
    else
      raise exception 'Supervision gate: Check-out of a supervised resource requires supervisor confirmation.';
    end if;
  end if;

  -- Update booking to in_use and record initial condition
  update public.bookings
  set status = 'in_use',
      actual_start_at = now(),
      initial_condition_code = v_clean_condition,
      initial_condition_checklist = coalesce(p_checklist, '{}'::jsonb),
      initial_condition_notes = p_notes,
      initial_acknowledged_by = v_user_id,
      initial_acknowledged_at = now(),
      updated_at = now()
  where id = p_booking_id;

  -- Record structured condition report
  insert into public.condition_reports (
    booking_id,
    phase,
    condition_code,
    checklist,
    notes,
    reporter_id,
    acknowledged_by
  ) values (
    p_booking_id,
    'start',
    v_clean_condition,
    coalesce(p_checklist, '{}'::jsonb),
    p_notes,
    v_booking.requester_id,
    v_user_id
  );

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
    coalesce(v_actor_role, 'borrower'),
    'booking',
    p_booking_id,
    'CHECKOUT_COMPLETED',
    'approved',
    'in_use',
    'Initial condition checklist verified and custody handed off.',
    jsonb_build_object(
      'resource_title', v_resource.title,
      'condition_code', v_clean_condition,
      'supervised', v_resource.requires_supervision,
      'supervisor_confirmed', v_is_supervisor_confirmed
    )
  );

  -- Notify borrower if owner initiated checkout, or notify owner if borrower initiated
  insert into public.notifications (
    recipient_id,
    type,
    related_entity_type,
    related_entity_id,
    message,
    dedupe_key
  ) values (
    case when v_user_id = v_booking.requester_id then v_resource.owner_id else v_booking.requester_id end,
    'general',
    'booking',
    p_booking_id,
    'Custody started for "' || v_resource.title || '". Initial condition: ' || v_clean_condition || '.',
    'checkout_' || p_booking_id::text
  );

  return jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'in_use',
    'initial_condition', v_clean_condition
  );
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 2. FUNCTION: SUBMIT RETURN WITH FINAL CONDITION
-- ==============================================================================
create or replace function public.submit_return(
  p_booking_id uuid,
  p_condition_code text,
  p_checklist jsonb default '{}'::jsonb,
  p_notes text default null
)
returns jsonb as $$
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
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 3. FUNCTION: OWNER CONFIRMATION OF RETURN
-- ==============================================================================
create or replace function public.confirm_return(
  p_booking_id uuid,
  p_confirmation_notes text default null,
  p_discrepancy_reported boolean default false
)
returns jsonb as $$
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
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 4. FUNCTION: REPORT DAMAGE, DELAY, OR SCHEDULING CONFLICT
-- ==============================================================================
create or replace function public.report_incident(
  p_resource_id uuid,
  p_booking_id uuid,
  p_type text,
  p_description text
)
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_clean_type text;
  v_clean_description text;
  v_resource record;
  v_booking record;
  v_incident_id uuid;
  v_actor_role text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  v_clean_type := lower(trim(coalesce(p_type, '')));
  if v_clean_type not in ('damage', 'delay', 'conflict', 'custody_mismatch', 'other') then
    raise exception 'Validation error: Incident type must be damage, delay, conflict, custody_mismatch, or other.';
  end if;

  v_clean_description := trim(coalesce(p_description, ''));
  if length(v_clean_description) = 0 then
    raise exception 'Validation error: Incident description is mandatory.';
  end if;

  select * into v_resource from public.resources where id = p_resource_id;
  if not found then
    raise exception 'Resource not found.';
  end if;

  if p_booking_id is not null then
    select * into v_booking from public.bookings where id = p_booking_id;
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  -- Insert incident record
  insert into public.incidents (
    booking_id,
    resource_id,
    type,
    description,
    status,
    reporter_id
  ) values (
    p_booking_id,
    p_resource_id,
    v_clean_type,
    v_clean_description,
    'open',
    v_user_id
  ) returning id into v_incident_id;

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
    'incident',
    v_incident_id,
    'INCIDENT_REPORTED',
    null,
    'open',
    v_clean_description,
    jsonb_build_object(
      'resource_title', v_resource.title,
      'incident_type', v_clean_type,
      'booking_id', p_booking_id
    )
  );

  -- Notify resource owner and campus management
  insert into public.notifications (
    recipient_id,
    type,
    related_entity_type,
    related_entity_id,
    message,
    dedupe_key
  ) values (
    v_resource.owner_id,
    'incident',
    'incident',
    v_incident_id,
    'Incident reported (' || v_clean_type || ') for "' || v_resource.title || '": ' || v_clean_description,
    'incident_rep_' || v_incident_id::text
  );

  return jsonb_build_object(
    'success', true,
    'incident_id', v_incident_id,
    'type', v_clean_type,
    'status', 'open'
  );
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 5. FUNCTION: AUTHORISED INCIDENT REVIEW AND RESOLUTION
-- ==============================================================================
create or replace function public.resolve_incident(
  p_incident_id uuid,
  p_status text,
  p_resolution_note text
)
returns jsonb as $$
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

  select * into v_incident from public.incidents where id = p_incident_id;
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
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 6. PERMISSIONS & FUNCTION SECURITY
-- ==============================================================================
revoke execute on function public.confirm_checkout(uuid, text, jsonb, text, boolean) from public;
revoke execute on function public.submit_return(uuid, text, jsonb, text) from public;
revoke execute on function public.confirm_return(uuid, text, boolean) from public;
revoke execute on function public.report_incident(uuid, uuid, text, text) from public;
revoke execute on function public.resolve_incident(uuid, text, text) from public;

grant execute on function public.confirm_checkout(uuid, text, jsonb, text, boolean) to authenticated;
grant execute on function public.submit_return(uuid, text, jsonb, text) to authenticated;
grant execute on function public.confirm_return(uuid, text, boolean) to authenticated;
grant execute on function public.report_incident(uuid, uuid, text, text) to authenticated;
grant execute on function public.resolve_incident(uuid, text, text) to authenticated;
