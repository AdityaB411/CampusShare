-- ==============================================================================
-- CampusShare Integration Test Suite: 003_handoff_return_tests.sql
-- Description: Self-contained, isolated test scenarios for handoff checkout,
--              supervision gate, condition verification, return hand-back,
--              damage incident creation, and human review/resolution.
-- Usage: Run in Supabase SQL Editor or psql on a disposable test database.
-- Isolation: Wrapped in BEGIN ... ROLLBACK transaction block to ensure ZERO
--            persistent side effects on database state, sequences, or audit logs.
-- ==============================================================================

BEGIN;

do $$
declare
  -- Fictional Test IDs
  v_owner_id uuid := '44444444-4444-4444-8444-444444444444'::uuid;
  v_supervisor_id uuid := '55555555-5555-4555-8555-555555555555'::uuid;
  v_borrower_id uuid := '66666666-6666-4666-8666-666666666666'::uuid;
  v_manager_id uuid := '77777777-7777-4777-8777-777777777777'::uuid;

  v_res_equipment uuid;
  v_res_supervised_space uuid;

  v_booking_eq uuid;
  v_booking_sp uuid;
  v_booking_tomorrow uuid;

  v_incident_id uuid;
  v_res jsonb;
  v_count int;
  v_now timestamptz := now();
begin
  raise notice '=====================================================';
  raise notice 'STARTING HANDOFF, RETURN, & INCIDENTS TEST SUITE';
  raise notice '=====================================================';

  -- ----------------------------------------------------------------------------
  -- SETUP: Isolated Fictional Test Users & Profiles (Non-colliding emails)
  -- ----------------------------------------------------------------------------
  insert into auth.users (id, email)
  values
    (v_owner_id, 'test_handoff_owner@test.campus.edu'),
    (v_supervisor_id, 'test_handoff_supervisor@test.campus.edu'),
    (v_borrower_id, 'test_handoff_borrower@test.campus.edu'),
    (v_manager_id, 'test_handoff_manager@test.campus.edu')
  on conflict (id) do nothing;

  insert into public.profiles (id, display_name, primary_role, campus_affiliation_status, owner_verification_status)
  values
    (v_owner_id, 'Prof. Raman', 'owner', 'verified', 'verified'),
    (v_supervisor_id, 'Dr. S. Nair', 'owner', 'verified', 'verified'),
    (v_borrower_id, 'Aarav Sharma', 'borrower', 'verified', 'unverified'),
    (v_manager_id, 'Campus Coordinator', 'manager', 'verified', 'unverified')
  on conflict (id) do update set
    campus_affiliation_status = excluded.campus_affiliation_status,
    owner_verification_status = excluded.owner_verification_status;

  -- Equipment Resource (Unsupervised)
  insert into public.resources (
    owner_id, type, category, title, summary, location_label, state, max_duration_hours, requires_supervision
  ) values (
    v_owner_id, 'equipment', 'Media Kit', 'Sony Cinema FX3 (Handoff Test Item)',
    'Camera kit with 24-70mm lens', 'Media Lab C-204', 'published', 4, false
  ) returning id into v_res_equipment;

  -- Space Resource (Supervised: Requires Supervisor Confirmation)
  insert into public.resources (
    owner_id, type, category, title, summary, location_label, state, max_duration_hours, requires_supervision
  ) values (
    v_owner_id, 'space', 'Lab Space', 'Robotics Testing Bay (Supervised Test)',
    'ESD-safe workbench and testing gear', 'Engineering E-102', 'published', 2, true
  ) returning id into v_res_supervised_space;

  -- Create approved booking for Equipment
  insert into public.bookings (
    resource_id, requester_id, start_time, end_time, purpose, status
  ) values (
    v_res_equipment, v_borrower_id, v_now - interval '30 minutes', v_now + interval '2 hours',
    'Documentary Filming', 'approved'
  ) returning id into v_booking_eq;

  -- Create approved booking for Supervised Space with assigned supervisor
  insert into public.bookings (
    resource_id, requester_id, supervisor_user_id, start_time, end_time, purpose, status
  ) values (
    v_res_supervised_space, v_borrower_id, v_supervisor_id, v_now - interval '10 minutes', v_now + interval '1 hour',
    'Autonomous Rover Test', 'approved'
  ) returning id into v_booking_sp;

  raise notice '[PASS] Test fixture setup completed.';

  -- ----------------------------------------------------------------------------
  -- TEST 1: Check-out with Initial Condition Checklist
  -- ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower_id::text)::text, true);

  v_res := public.confirm_checkout(
    p_booking_id => v_booking_eq,
    p_condition_code => 'good',
    p_checklist => '{"lens_clean": true, "batteries_charged": true, "pelican_case_intact": true}'::jsonb,
    p_notes => 'Camera body and accessories inspected in clean working order.'
  );

  if (v_res->>'status') <> 'in_use' then
    raise exception 'Test 1 Failed: Status is %, expected in_use', (v_res->>'status');
  end if;

  select count(*) into v_count from public.activity_events where entity_id = v_booking_eq and action = 'CHECKOUT_COMPLETED';
  if v_count <> 1 then
    raise exception 'Test 1 Failed: CHECKOUT_COMPLETED audit event missing.';
  end if;

  raise notice '[PASS] Test 1: Check-out recorded initial condition checklist and transitioned booking to in_use.';

  -- ----------------------------------------------------------------------------
  -- TEST 2: Supervision Gate on Supervised Space Checkout
  -- ----------------------------------------------------------------------------
  -- Attempt checkout as borrower WITHOUT supervisor confirmation -> must fail
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower_id::text)::text, true);

  begin
    perform public.confirm_checkout(
      p_booking_id => v_booking_sp,
      p_condition_code => 'good',
      p_supervisor_confirmation => false
    );
    raise exception 'Test 2 Failed: Supervised checkout succeeded without supervisor confirmation!';
  exception
    when others then
      if sqlerrm like '%Supervision gate%' then
        raise notice '[PASS] Test 2a: Checkout blocked when required supervisor confirmation is absent.';
      else
        raise;
      end if;
  end;

  -- Checkout WITH supervisor confirmation -> succeeds
  perform set_config('request.jwt.claims', json_build_object('sub', v_supervisor_id::text)::text, true);

  v_res := public.confirm_checkout(
    p_booking_id => v_booking_sp,
    p_condition_code => 'good',
    p_checklist => '{"safety_glasses_present": true, "fire_extinguisher_clear": true}'::jsonb,
    p_notes => 'Supervisor Dr. Nair confirmed presence on site.'
  );

  if (v_res->>'status') <> 'in_use' then
    raise exception 'Test 2b Failed: Supervised checkout failed when confirmed by supervisor.';
  end if;

  raise notice '[PASS] Test 2b: Supervised space checked out with verified supervisor confirmation.';

  -- ----------------------------------------------------------------------------
  -- TEST 3: Overdue / In-Use Resource Custody Blocker
  -- ----------------------------------------------------------------------------
  -- Borrower submits another booking request for equipment for tomorrow
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower_id::text)::text, true);

  insert into public.bookings (
    resource_id, requester_id, start_time, end_time, purpose, status
  ) values (
    v_res_equipment, v_borrower_id, v_now + interval '24 hours', v_now + interval '26 hours',
    'Follow up shoot', 'pending_owner_review'
  ) returning id into v_booking_tomorrow;

  -- Owner attempts to approve tomorrow's request while item is in active physical custody (in_use)
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id::text)::text, true);

  begin
    perform public.approve_booking_request(p_booking_id => v_booking_tomorrow);
    raise exception 'Test 3 Failed: Approval succeeded while resource was checked out!';
  exception
    when others then
      if sqlerrm like '%Active custody blocker%' then
        raise notice '[PASS] Test 3: Custody blocker prevented new approval while resource is actively in-use.';
      else
        raise;
      end if;
  end;

  -- ----------------------------------------------------------------------------
  -- TEST 4: Return Submission with Worsened Condition (Automatic Incident Review)
  -- ----------------------------------------------------------------------------
  -- Borrower returns equipment with damaged lens filter
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower_id::text)::text, true);

  v_res := public.submit_return(
    p_booking_id => v_booking_eq,
    p_condition_code => 'damaged',
    p_checklist => '{"lens_clean": false, "scratch_on_filter": true}'::jsonb,
    p_notes => 'Lens UV filter cracked during outdoor shoot on gravel path.'
  );

  if (v_res->>'status') <> 'return_pending' then
    raise exception 'Test 4 Failed: Expected return_pending status, got %', (v_res->>'status');
  end if;

  v_incident_id := (v_res->>'incident_id')::uuid;
  if v_incident_id is null then
    raise exception 'Test 4 Failed: Worsened condition did not automatically trigger incident report!';
  end if;

  select count(*) into v_count from public.activity_events where entity_id = v_booking_eq and action = 'RETURN_SUBMITTED';
  if v_count <> 1 then
    raise exception 'Test 4 Failed: RETURN_SUBMITTED audit event missing.';
  end if;

  raise notice '[PASS] Test 4: Return submitted with damaged condition -> return_pending status & open incident created for human review (zero automated penalty).';

  -- ----------------------------------------------------------------------------
  -- TEST 5: Owner Hand-Back Confirmation Releases Resource
  -- ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id::text)::text, true);

  v_res := public.confirm_return(
    p_booking_id => v_booking_eq,
    p_confirmation_notes => 'Physical hand-back confirmed in Media Lab. Lens filter damage acknowledged; camera body unharmed.'
  );

  if (v_res->>'status') <> 'returned' then
    raise exception 'Test 5 Failed: Expected status returned, got %', (v_res->>'status');
  end if;

  -- Now that physical custody is confirmed returned, owner CAN approve tomorrow's reservation!
  v_res := public.approve_booking_request(
    p_booking_id => v_booking_tomorrow,
    p_decision_reason => 'Previous equipment custody released; slot conflict-free.'
  );

  if (v_res->>'status') <> 'approved' then
    raise exception 'Test 5 Failed: Approval after return release failed!';
  end if;

  raise notice '[PASS] Test 5: Owner confirmed return -> status returned and resource successfully released for subsequent approvals.';

  -- ----------------------------------------------------------------------------
  -- TEST 6: Manual Incident Reporting (e.g., Delay / Scheduling Conflict)
  -- ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower_id::text)::text, true);

  v_res := public.report_incident(
    p_resource_id => v_res_supervised_space,
    p_booking_id => v_booking_sp,
    p_type => 'conflict',
    p_description => 'Another project group had equipment setup on workbench 3 causing a 20-minute delay.'
  );

  if (v_res->>'status') <> 'open' then
    raise exception 'Test 6 Failed: Reported incident status is not open.';
  end if;

  raise notice '[PASS] Test 6: Manual conflict incident reported and linked to booking and resource.';

  -- ----------------------------------------------------------------------------
  -- TEST 7: Human Incident Review with Mandatory Resolution Note
  -- ----------------------------------------------------------------------------
  -- Attempt resolution with empty note -> must fail
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager_id::text)::text, true);

  begin
    perform public.resolve_incident(
      p_incident_id => v_incident_id,
      p_status => 'resolved',
      p_resolution_note => '  '
    );
    raise exception 'Test 7 Failed: Blank resolution note was accepted!';
  exception
    when others then
      if sqlerrm like '%human resolution note%' then
        raise notice '[PASS] Test 7a: Blank incident resolution note correctly blocked.';
      else
        raise;
      end if;
  end;

  -- Authorised resolution by campus manager with explanation
  v_res := public.resolve_incident(
    p_incident_id => v_incident_id,
    p_status => 'resolved',
    p_resolution_note => 'Media center lab technician replaced UV filter from departmental spare stock. No borrower liability assessed.'
  );

  if (v_res->>'status') <> 'resolved' then
    raise exception 'Test 7b Failed: Incident resolution failed.';
  end if;

  select count(*) into v_count from public.activity_events where entity_id = v_incident_id and action = 'INCIDENT_RESOLVED';
  if v_count <> 1 then
    raise exception 'Test 7b Failed: INCIDENT_RESOLVED audit event missing.';
  end if;

  raise notice '[PASS] Test 7b: Incident reviewed and resolved by authorized coordinator with recorded note and audit trail.';

  raise notice '=====================================================';
  raise notice 'ALL 7 HANDOFF & RETURN TESTS PASSED SUCCESSFULLY!';
  raise notice '=====================================================';

end $$;

-- ------------------------------------------------------------------------------
-- Roll back the transaction to ensure zero changes persist to database
-- ------------------------------------------------------------------------------
ROLLBACK;
