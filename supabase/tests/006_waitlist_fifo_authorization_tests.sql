-- ==============================================================================
-- CampusShare Waitlist FIFO Suite: 006_waitlist_fifo_authorization_tests.sql
-- Verifies custodian-only waitlisting and FIFO by actual waitlist-entry time.
-- Run ONLY on a disposable test database; all fixtures are rolled back.
-- ==============================================================================
begin;

do $campusshare_waitlist_fifo_tests$
declare
  v_owner uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
  v_borrower_1 uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02';
  v_borrower_2 uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03';
  v_resource uuid;
  v_booking_1 uuid;
  v_booking_2 uuid;
  v_result jsonb;
begin
  insert into auth.users(id, email) values
    (v_owner, 'waitlist-owner-006@test.campus.edu'),
    (v_borrower_1, 'waitlist-borrower1-006@test.campus.edu'),
    (v_borrower_2, 'waitlist-borrower2-006@test.campus.edu')
  on conflict (id) do nothing;

  update public.profiles
  set primary_role = 'owner', campus_affiliation_status = 'verified', owner_verification_status = 'verified'
  where id = v_owner;
  update public.profiles set campus_affiliation_status = 'verified'
  where id in (v_borrower_1, v_borrower_2);

  insert into public.resources (
    owner_id, type, category, title, summary, location_label, state,
    max_duration_hours, requires_supervision
  ) values (
    v_owner, 'equipment', 'Waitlist Tests', 'Temporary FIFO Test Resource',
    'Disposable integration fixture', 'Test Lab', 'published', 4, false
  ) returning id into v_resource;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_borrower_1::text, 'role', 'authenticated')::text, true);
  v_result := public.submit_booking_request(
    v_resource, now() + interval '2 hours', now() + interval '3 hours',
    'Waitlist FIFO test 1', null, null
  );
  v_booking_1 := (v_result->>'booking_id')::uuid;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_borrower_2::text, 'role', 'authenticated')::text, true);
  v_result := public.submit_booking_request(
    v_resource, now() + interval '2 hours', now() + interval '3 hours',
    'Waitlist FIFO test 2', null, null
  );
  v_booking_2 := (v_result->>'booking_id')::uuid;

  begin
    perform public.waitlist_booking_request(v_booking_1, 'Borrowers cannot decide waitlisting');
    raise exception 'TEST_FAIL: borrower self-waitlisted a booking';
  exception when others then
    if sqlerrm like 'TEST_FAIL:%' then raise; end if;
    if sqlerrm not ilike 'Permission denied: Only the resource owner or campus staff%' then
      raise exception 'TEST_FAIL: unexpected borrower waitlist result: %', sqlerrm;
    end if;
  end;

  -- The second request is deliberately given an earlier request timestamp.
  -- Queue order still follows when each request actually entered the waitlist.
  update public.bookings set created_at = now() where id = v_booking_1;
  update public.bookings set created_at = now() - interval '1 minute' where id = v_booking_2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  v_result := public.waitlist_booking_request(v_booking_1, 'Owner decision: no remaining slot');
  if (v_result->>'queue_position')::integer <> 1 then
    raise exception 'TEST_FAIL: first waitlisted booking should have queue position 1';
  end if;

  v_result := public.waitlist_booking_request(v_booking_2, 'Owner decision: no remaining slot');
  if (v_result->>'queue_position')::integer <> 2 then
    raise exception 'TEST_FAIL: second waitlisted booking should have queue position 2';
  end if;

  if not exists (
    select 1 from public.bookings b1 join public.bookings b2 on b2.id = v_booking_2
    where b1.id = v_booking_1 and b1.waitlisted_at < b2.waitlisted_at
  ) then
    raise exception 'TEST_FAIL: persisted waitlist timestamps do not preserve FIFO order';
  end if;

  raise notice 'PASS: borrower self-waitlisting denied; queue positions follow actual waitlist-entry time.';
end;
$campusshare_waitlist_fifo_tests$;

rollback;
