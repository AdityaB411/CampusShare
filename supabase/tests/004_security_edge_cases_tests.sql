-- ==============================================================================
-- CampusShare Security Edge-Case Suite: 004_security_edge_cases_tests.sql
-- Covers role separation, direct profile escalation, extension duration/duplicates,
-- and concurrent-overlap guard behavior. Run ONLY on a disposable test database.
-- Every fixture and audit event is rolled back.
-- ==============================================================================
begin;

do $campusshare_security_edge_tests$
declare
  v_admin uuid := '88888888-8888-4888-8888-888888888801';
  v_manager uuid := '88888888-8888-4888-8888-888888888802';
  v_owner uuid := '88888888-8888-4888-8888-888888888803';
  v_borrower_1 uuid := '88888888-8888-4888-8888-888888888804';
  v_borrower_2 uuid := '88888888-8888-4888-8888-888888888805';
  v_target uuid := '88888888-8888-4888-8888-888888888806';
  v_resource uuid;
  v_booking_1 uuid;
  v_booking_2 uuid;
  v_result jsonb;
  v_role text;
begin
  insert into auth.users (id, email) values
    (v_admin, 'security-admin-004@test.campus.edu'),
    (v_manager, 'security-manager-004@test.campus.edu'),
    (v_owner, 'security-owner-004@test.campus.edu'),
    (v_borrower_1, 'security-borrower1-004@test.campus.edu'),
    (v_borrower_2, 'security-borrower2-004@test.campus.edu'),
    (v_target, 'security-target-004@test.campus.edu')
  on conflict (id) do nothing;

  update public.profiles
    set primary_role = 'admin', campus_affiliation_status = 'verified'
    where id = v_admin;
  update public.profiles
    set primary_role = 'manager', campus_affiliation_status = 'verified'
    where id = v_manager;
  update public.profiles
    set primary_role = 'owner', campus_affiliation_status = 'verified',
        owner_verification_status = 'verified'
    where id = v_owner;
  update public.profiles
    set campus_affiliation_status = 'verified'
    where id in (v_borrower_1, v_borrower_2);

  -- Manager verification may update status, but must never change primary_role.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
  begin
    update public.profiles set primary_role = 'admin' where id = v_target;
    raise exception 'TEST_FAIL: manager directly elevated a profile role';
  exception when others then
    if sqlerrm like 'TEST_FAIL:%' then raise; end if;
    if sqlerrm not ilike 'Security violation: only a system administrator%' then
      raise exception 'TEST_FAIL: unexpected direct role-update result: %', sqlerrm;
    end if;
  end;

  perform public.verify_user_status(v_target, 'verified', 'verified');
  select primary_role into v_role from public.profiles where id = v_target;
  if v_role <> 'borrower' then
    raise exception 'TEST_FAIL: verification unexpectedly changed primary_role';
  end if;

  begin
    perform public.assign_user_role(v_target, 'owner');
    raise exception 'TEST_FAIL: manager assigned a role through RPC';
  exception when others then
    if sqlerrm like 'TEST_FAIL:%' then raise; end if;
    if sqlerrm not ilike 'Permission denied:%' then
      raise exception 'TEST_FAIL: unexpected manager role-assignment result: %', sqlerrm;
    end if;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  perform public.assign_user_role(v_target, 'owner');
  select primary_role into v_role from public.profiles where id = v_target;
  if v_role <> 'owner' then
    raise exception 'TEST_FAIL: administrator role assignment did not apply';
  end if;

  insert into public.resources (
    owner_id, type, category, title, summary, location_label, state,
    max_duration_hours, required_training_code, requires_supervision
  ) values (
    v_owner, 'equipment', 'Security Tests', 'Temporary Security Test Resource',
    'Disposable integration fixture', 'Test Lab', 'published', 4, null, false
  ) returning id into v_resource;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_borrower_1::text, 'role', 'authenticated')::text, true);
  v_result := public.submit_booking_request(
    v_resource, now() + interval '2 hours', now() + interval '3 hours',
    'Security edge test booking 1', null, null
  );
  v_booking_1 := (v_result->>'booking_id')::uuid;
  if v_result->>'status' <> 'pending_owner_review' then
    raise exception 'TEST_FAIL: first booking did not enter pending_owner_review';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  perform public.approve_booking_request(v_booking_1, 'Test approval', null);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_borrower_1::text, 'role', 'authenticated')::text, true);
  begin
    perform public.request_booking_extension(
      v_booking_1, now() + interval '8 hours', 'Should exceed resource maximum'
    );
    raise exception 'TEST_FAIL: extension exceeded resource maximum duration';
  exception when others then
    if sqlerrm like 'TEST_FAIL:%' then raise; end if;
    if sqlerrm not ilike 'Extension blocked: total booking duration cannot exceed%' then
      raise exception 'TEST_FAIL: unexpected maximum-duration result: %', sqlerrm;
    end if;
  end;

  v_result := public.request_booking_extension(
    v_booking_1, now() + interval '4 hours', 'Valid short extension'
  );
  if v_result->>'status' <> 'pending' then
    raise exception 'TEST_FAIL: valid extension was not marked pending';
  end if;

  begin
    perform public.request_booking_extension(
      v_booking_1, now() + interval '4 hours', 'Duplicate pending extension'
    );
    raise exception 'TEST_FAIL: duplicate pending extension was accepted';
  exception when others then
    if sqlerrm like 'TEST_FAIL:%' then raise; end if;
    if sqlerrm not ilike 'There is already a pending extension request%' then
      raise exception 'TEST_FAIL: unexpected duplicate-extension result: %', sqlerrm;
    end if;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  perform public.decide_booking_extension(v_booking_1, 'approved', 'Valid extension');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_borrower_2::text, 'role', 'authenticated')::text, true);
  v_result := public.submit_booking_request(
    v_resource, now() + interval '2 hours', now() + interval '3 hours',
    'Overlapping booking test', null, null
  );
  v_booking_2 := (v_result->>'booking_id')::uuid;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  begin
    perform public.approve_booking_request(v_booking_2, 'Must conflict', null);
    raise exception 'TEST_FAIL: overlapping booking was approved';
  exception when others then
    if sqlerrm like 'TEST_FAIL:%' then raise; end if;
    if sqlerrm not ilike 'Scheduling conflict:%' then
      raise exception 'TEST_FAIL: unexpected overlap result: %', sqlerrm;
    end if;
  end;

  raise notice 'PASS: role escalation denied, verification separated from roles, admin assignment allowed, extension maximum and duplicate checks enforced, overlapping booking blocked.';
end;
$campusshare_security_edge_tests$;

rollback;
