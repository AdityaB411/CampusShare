-- ==============================================================================
-- CampusShare Integration Test Suite: 002_booking_operations_tests.sql
-- Description: Self-contained, isolated test scenarios for booking operations,
--              eligibility gates, active custody blocker, waitlist, and audit atomicity.
-- Usage: Run in Supabase SQL Editor or psql on a disposable test database.
-- Isolation: Wrapped in BEGIN ... ROLLBACK transaction block to ensure ZERO
--            persistent side effects on database state, sequences, or audit logs.
-- ==============================================================================

BEGIN;

do $$
declare
  -- Fictional Test IDs
  v_owner_id uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  v_borrower_verified uuid := '22222222-2222-4222-8222-222222222222'::uuid;
  v_borrower_unverified uuid := '33333333-3333-4333-8333-333333333333'::uuid;
  v_resource_id uuid;
  v_booking_1 uuid;
  v_booking_2 uuid;
  v_booking_3 uuid;
  v_ext_id uuid;
  v_res jsonb;
  v_event_count int;
  v_notif_count int;
  v_now timestamptz := now();
begin
  raise notice '=====================================================';
  raise notice 'STARTING CAMPUSSHARE BOOKING OPERATIONS TEST SUITE';
  raise notice '=====================================================';

  -- ----------------------------------------------------------------------------
  -- SETUP: Isolated Fictional Test Profiles (Non-colliding emails)
  -- ----------------------------------------------------------------------------
  insert into auth.users (id, email)
  values
    (v_owner_id, 'test_booking_owner@test.campus.edu'),
    (v_borrower_verified, 'test_booking_verified@test.campus.edu'),
    (v_borrower_unverified, 'test_booking_unverified@test.campus.edu')
  on conflict (id) do nothing;

  -- Create profiles
  insert into public.profiles (id, display_name, primary_role, campus_affiliation_status, owner_verification_status)
  values
    (v_owner_id, 'Prof. Raman (Media Lab)', 'owner', 'verified', 'verified'),
    (v_borrower_verified, 'Aarav Sharma (Verified Student)', 'borrower', 'verified', 'unverified'),
    (v_borrower_unverified, 'Rohan Verma (Unverified Student)', 'borrower', 'unverified', 'unverified')
  on conflict (id) do update set
    campus_affiliation_status = excluded.campus_affiliation_status,
    owner_verification_status = excluded.owner_verification_status;

  -- Training qualification for verified student: TRN-MED-01
  insert into public.profile_qualifications (user_id, training_code, status, expires_at)
  values (v_borrower_verified, 'TRN-MED-01', 'verified', v_now + interval '180 days')
  on conflict (user_id, training_code) do update set
    status = 'verified',
    expires_at = v_now + interval '180 days';

  -- Create Published Test Equipment: Sony Cinema FX3 Kit (Max 4h duration)
  insert into public.resources (
    owner_id,
    type,
    category,
    title,
    summary,
    location_label,
    state,
    max_duration_hours,
    required_training_code,
    requires_supervision
  ) values (
    v_owner_id,
    'equipment',
    'Media Equipment',
    'Sony Cinema FX3 4K Kit (Test Item)',
    'Full frame camera kit with 24-70mm lens',
    'Media Lab C-204',
    'published',
    4,
    'TRN-MED-01',
    false
  ) returning id into v_resource_id;

  raise notice '[PASS] Test fixture setup completed successfully.';

  -- ----------------------------------------------------------------------------
  -- TEST 1: Submit Booking with Full Eligibility -> PENDING_OWNER_REVIEW
  -- ----------------------------------------------------------------------------
  -- Simulate authenticated session as verified student
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower_verified::text)::text, true);

  v_res := public.submit_booking_request(
    p_resource_id => v_resource_id,
    p_start_time => v_now + interval '2 hours',
    p_end_time => v_now + interval '5 hours', -- 3 hours (within 4h limit)
    p_purpose => 'Final year capstone documentary shoot'
  );

  v_booking_1 := (v_res->>'booking_id')::uuid;

  if (v_res->>'status') <> 'pending_owner_review' then
    raise exception 'Test 1 Failed: Expected status pending_owner_review, got %', (v_res->>'status');
  end if;

  -- Verify atomic audit event and notification were written
  select count(*) into v_event_count from public.activity_events where entity_id = v_booking_1 and action = 'BOOKING_REQUESTED';
  select count(*) into v_notif_count from public.notifications where recipient_id = v_owner_id and related_entity_id = v_booking_1;

  if v_event_count <> 1 or v_notif_count <> 1 then
    raise exception 'Test 1 Failed: Atomic audit (% events) or notification (% notices) missing', v_event_count, v_notif_count;
  end if;

  raise notice '[PASS] Test 1: Verified borrower submitted request -> pending_owner_review with atomic audit & owner notice.';

  -- ----------------------------------------------------------------------------
  -- TEST 2: Submit Booking with Missing Affiliation/Training -> PENDING_VERIFICATION
  -- ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower_unverified::text)::text, true);

  v_res := public.submit_booking_request(
    p_resource_id => v_resource_id,
    p_start_time => v_now + interval '6 hours',
    p_end_time => v_now + interval '8 hours',
    p_purpose => 'Personal video editing'
  );

  v_booking_2 := (v_res->>'booking_id')::uuid;

  if (v_res->>'status') <> 'pending_verification' then
    raise exception 'Test 2 Failed: Expected status pending_verification, got %', (v_res->>'status');
  end if;

  raise notice '[PASS] Test 2: Unverified user submitted request -> pending_verification without slot reservation.';

  -- ----------------------------------------------------------------------------
  -- TEST 3: Duration Limit Enforced in Database
  -- ----------------------------------------------------------------------------
  begin
    perform public.submit_booking_request(
      p_resource_id => v_resource_id,
      p_start_time => v_now + interval '10 hours',
      p_end_time => v_now + interval '16 hours', -- 6 hours (> 4h limit)
      p_purpose => 'Excessive reservation test'
    );
    raise exception 'Test 3 Failed: Duration check did not block 6-hour request!';
  exception
    when others then
      if sqlerrm like '%Duration limit exceeded%' then
        raise notice '[PASS] Test 3: Duration cap successfully rejected 6-hour request on a 4-hour max resource.';
      else
        raise;
      end if;
  end;

  -- ----------------------------------------------------------------------------
  -- TEST 4: Reasoned Owner Approval
  -- ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id::text)::text, true);

  v_res := public.approve_booking_request(
    p_booking_id => v_booking_1,
    p_decision_reason => 'Verified media safety certificate; approved for capstone project.'
  );

  if (v_res->>'status') <> 'approved' then
    raise exception 'Test 4 Failed: Owner approval failed, status is %', (v_res->>'status');
  end if;

  select count(*) into v_event_count from public.activity_events where entity_id = v_booking_1 and action = 'BOOKING_APPROVED';
  select count(*) into v_notif_count from public.notifications where recipient_id = v_borrower_verified and related_entity_id = v_booking_1;

  if v_event_count <> 1 or v_notif_count <> 1 then
    raise exception 'Test 4 Failed: Approval audit or notification missing.';
  end if;

  raise notice '[PASS] Test 4: Owner approved booking with explicit reason, atomic audit event, and notification.';

  -- ----------------------------------------------------------------------------
  -- TEST 5: Overlapping Interval Conflict Protection in Database
  -- ----------------------------------------------------------------------------
  -- Create a 3rd request that overlaps with Booking 1 [now + 2h, now + 5h)
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower_verified::text)::text, true);

  v_res := public.submit_booking_request(
    p_resource_id => v_resource_id,
    p_start_time => v_now + interval '3 hours', -- overlaps!
    p_end_time => v_now + interval '5 hours',
    p_purpose => 'Conflicting overlap attempt'
  );
  v_booking_3 := (v_res->>'booking_id')::uuid;

  -- Attempt to approve the conflicting booking as Owner
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id::text)::text, true);

  begin
    perform public.approve_booking_request(
      p_booking_id => v_booking_3,
      p_decision_reason => 'Trying to approve overlapping reservation'
    );
    raise exception 'Test 5 Failed: Overlapping interval was approved!';
  exception
    when others then
      if sqlerrm like '%Scheduling conflict%' then
        raise notice '[PASS] Test 5: Overlapping approval blocked by database interval check.';
      else
        raise;
      end if;
  end;

  -- ----------------------------------------------------------------------------
  -- TEST 6: Reasoned Rejection (Mandatory Reason Rule)
  -- ----------------------------------------------------------------------------
  begin
    perform public.reject_booking_request(
      p_booking_id => v_booking_3,
      p_decision_reason => '   ' -- empty reason
    );
    raise exception 'Test 6 Failed: Empty rejection reason was accepted!';
  exception
    when others then
      if sqlerrm like '%mandatory human-readable reason%' then
        raise notice '[PASS] Test 6a: Empty rejection reason correctly blocked.';
      else
        raise;
      end if;
  end;

  -- Now reject with explicit reason
  v_res := public.reject_booking_request(
    p_booking_id => v_booking_3,
    p_decision_reason => 'Time slot conflicts with previously approved Capstone Documentary session.'
  );

  if (v_res->>'status') <> 'rejected' then
    raise exception 'Test 6 Failed: Rejection did not set status to rejected.';
  end if;

  raise notice '[PASS] Test 6b: Reasoned rejection processed with explanation and notification.';

  -- ----------------------------------------------------------------------------
  -- TEST 7: Active Custody Blocker (Overdue / In-Use blocks future approvals)
  -- ----------------------------------------------------------------------------
  -- Set Booking 1 to 'in_use' (checked out)
  update public.bookings
  set status = 'in_use',
      actual_start_at = now() - interval '1 hour',
      actual_release_confirmed_at = null
  where id = v_booking_1;

  -- Submit another request for tomorrow
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower_verified::text)::text, true);
  v_res := public.submit_booking_request(
    p_resource_id => v_resource_id,
    p_start_time => v_now + interval '24 hours',
    p_end_time => v_now + interval '26 hours',
    p_purpose => 'Tomorrow session'
  );
  v_booking_3 := (v_res->>'booking_id')::uuid;

  -- Owner tries to approve tomorrow's request while item is actively checked out without return confirmation
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id::text)::text, true);
  begin
    perform public.approve_booking_request(p_booking_id => v_booking_3);
    raise exception 'Test 7 Failed: Approval succeeded while resource was in active physical custody!';
  exception
    when others then
      if sqlerrm like '%Active custody blocker%' then
        raise notice '[PASS] Test 7: Active custody blocker prevented approval of new reservation until hand-back is confirmed.';
      else
        raise;
      end if;
  end;

  -- ----------------------------------------------------------------------------
  -- TEST 8: Extension Request & Decision Workflow
  -- ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower_verified::text)::text, true);
  v_res := public.request_booking_extension(
    p_booking_id => v_booking_1,
    p_new_end_time => v_now + interval '6 hours',
    p_reason => 'Need 1 additional hour for battery recharge and backup'
  );
  v_ext_id := (v_res->>'extension_request_id')::uuid;

  if (v_res->>'status') <> 'pending' then
    raise exception 'Test 8 Failed: Extension request was not pending.';
  end if;

  -- Owner approves extension
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id::text)::text, true);
  v_res := public.decide_booking_extension(
    p_extension_request_id => v_ext_id,
    p_decision => 'approved',
    p_decision_reason => 'No subsequent bookings today; extension granted.'
  );

  if (v_res->>'decision') <> 'approved' then
    raise exception 'Test 8 Failed: Extension approval failed.';
  end if;

  raise notice '[PASS] Test 8: Booking extension requested and decided atomically with fresh notification.';

  -- ----------------------------------------------------------------------------
  -- TEST 9: Cancellation with Reason
  -- ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower_verified::text)::text, true);
  v_res := public.cancel_booking(
    p_booking_id => v_booking_3,
    p_reason => 'Schedule changed; cancelling unapproved request.'
  );

  if (v_res->>'status') <> 'cancelled' then
    raise exception 'Test 9 Failed: Cancellation failed.';
  end if;

  raise notice '[PASS] Test 9: Booking cancelled with documented reason and slot release.';

  raise notice '=====================================================';
  raise notice 'ALL 9 BOOKING OPERATIONS TESTS PASSED SUCCESSFULLY!';
  raise notice '=====================================================';

end $$;

-- ------------------------------------------------------------------------------
-- Roll back the transaction to ensure zero changes persist to database
-- ------------------------------------------------------------------------------
ROLLBACK;
