-- ==============================================================================
-- CampusShare Project-Group Lifecycle Suite: 005_group_lifecycle_audit_tests.sql
-- Covers group creation audit, membership decision audit/notification, idempotency,
-- and null-safe staff verification. Run ONLY on a disposable test database.
-- ==============================================================================
begin;

do $campusshare_group_lifecycle_tests$
declare
  v_borrower uuid := '99999999-9999-4999-8999-999999999901';
  v_manager uuid := '99999999-9999-4999-8999-999999999902';
  v_group_id uuid;
  v_member_id uuid;
  v_result jsonb;
  v_count integer;
begin
  insert into auth.users (id, email) values
    (v_borrower, 'group-borrower-005@test.campus.edu'),
    (v_manager, 'group-manager-005@test.campus.edu')
  on conflict (id) do nothing;

  update public.profiles set campus_affiliation_status = 'verified' where id = v_borrower;
  update public.profiles set primary_role = 'manager', campus_affiliation_status = 'verified' where id = v_manager;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_borrower::text, 'role', 'authenticated')::text, true);
  v_result := public.create_project_group('CampusShare Group Lifecycle Test');
  v_group_id := (v_result->>'group_id')::uuid;
  if v_group_id is null or coalesce((v_result->>'is_verified')::boolean, true) then
    raise exception 'TEST_FAIL: student-created group should require staff verification';
  end if;

  select id into v_member_id from public.group_members
  where group_id = v_group_id and user_id = v_borrower;
  if v_member_id is null then raise exception 'TEST_FAIL: creator membership missing'; end if;

  select count(*) into v_count from public.activity_events
  where entity_type = 'project_group' and entity_id = v_group_id and action = 'PROJECT_GROUP_CREATED';
  if v_count <> 1 then raise exception 'TEST_FAIL: group creation audit event missing'; end if;

  select count(*) into v_count from public.activity_events
  where entity_type = 'group_membership' and entity_id = v_member_id and action = 'GROUP_MEMBERSHIP_CREATED';
  if v_count <> 1 then raise exception 'TEST_FAIL: creator membership audit event missing'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
  v_result := public.decide_group_membership(v_member_id, 'removed');
  if v_result->>'changed' <> 'true' then raise exception 'TEST_FAIL: membership decision not recorded'; end if;

  select count(*) into v_count from public.activity_events
  where entity_id = v_member_id and action = 'GROUP_MEMBERSHIP_STATUS_CHANGED';
  if v_count <> 1 then raise exception 'TEST_FAIL: membership status audit event missing'; end if;

  select count(*) into v_count from public.notifications
  where recipient_id = v_borrower and related_entity_id = v_member_id and message like '%now removed%';
  if v_count <> 1 then raise exception 'TEST_FAIL: membership status notification missing'; end if;

  v_result := public.decide_group_membership(v_member_id, 'removed');
  if v_result->>'changed' <> 'false' then raise exception 'TEST_FAIL: repeated membership decision should be idempotent'; end if;

  begin
    perform public.verify_project_group(v_group_id, null);
    raise exception 'TEST_FAIL: null group verification state accepted';
  exception when others then
    if sqlerrm like 'TEST_FAIL:%' then raise; end if;
    if sqlerrm not ilike 'Validation error: Group verification status must be true or false%' then
      raise exception 'TEST_FAIL: unexpected null verification result: %', sqlerrm;
    end if;
  end;

  v_result := public.verify_project_group(v_group_id, true);
  if coalesce((v_result->>'is_verified')::boolean, false) is not true then
    raise exception 'TEST_FAIL: staff group verification failed';
  end if;

  raise notice 'PASS: group creation/membership audit, staff decision notification, idempotency, and null-safe group verification.';
end;
$campusshare_group_lifecycle_tests$;

rollback;
