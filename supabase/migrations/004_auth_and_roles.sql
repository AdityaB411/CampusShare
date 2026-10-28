-- ==============================================================================
-- CampusShare Migration 004: 004_auth_and_roles.sql
-- Description: Server-side authorization functions for role assignment,
--              user verification, and owner requests. Enforces security in
--              PostgreSQL rather than relying on frontend logic.
-- Compatible with: Supabase SQL Editor & PostgreSQL 15+
-- ==============================================================================

-- ==============================================================================
-- 1. FUNCTION: REQUEST OWNER ACCESS (Borrower initiates, does not grant)
-- ==============================================================================
create or replace function public.request_owner_verification()
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  if not found then
    raise exception 'Profile not found.';
  end if;

  if v_profile.owner_verification_status = 'verified' then
    return jsonb_build_object('success', true, 'message', 'Owner status is already verified.');
  end if;

  update public.profiles
  set owner_verification_status = 'pending',
      updated_at = now()
  where id = v_user_id;

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
    v_profile.primary_role,
    'profile',
    v_user_id,
    'OWNER_ACCESS_REQUESTED',
    v_profile.owner_verification_status,
    'pending',
    'User submitted a request for resource owner authorization.',
    jsonb_build_object('display_name', v_profile.display_name)
  );

  return jsonb_build_object(
    'success', true,
    'status', 'pending',
    'message', 'Owner verification request submitted. Awaiting manager review.'
  );
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 2. FUNCTION: REQUEST CAMPUS AFFILIATION VERIFICATION
-- ==============================================================================
create or replace function public.request_affiliation_verification()
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  if not found then
    raise exception 'Profile not found.';
  end if;

  if v_profile.campus_affiliation_status = 'verified' then
    return jsonb_build_object('success', true, 'message', 'Campus affiliation is already verified.');
  end if;

  update public.profiles
  set campus_affiliation_status = 'pending',
      updated_at = now()
  where id = v_user_id;

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
    v_profile.primary_role,
    'profile',
    v_user_id,
    'AFFILIATION_REQUESTED',
    v_profile.campus_affiliation_status,
    'pending',
    'User requested campus affiliation verification.',
    jsonb_build_object('display_name', v_profile.display_name)
  );

  return jsonb_build_object(
    'success', true,
    'status', 'pending',
    'message', 'Affiliation verification request submitted.'
  );
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 3. FUNCTION: VERIFY USER STATUS (Managers & Admins only)
-- ==============================================================================
create or replace function public.verify_user_status(
  p_target_user_id uuid,
  p_affiliation_status text default null,
  p_owner_status text default null
)
returns jsonb as $$
declare
  v_caller_id uuid := auth.uid();
  v_target record;
  v_caller_role text;
  v_new_role text;
begin
  if v_caller_id is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only campus managers and administrators can verify users.';
  end if;

  select * into v_target from public.profiles where id = p_target_user_id;
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

  -- If verifying as owner, elevate primary_role from borrower to owner if not already manager/admin
  v_new_role := v_target.primary_role;
  if p_owner_status = 'verified' and v_target.primary_role = 'borrower' then
    v_new_role := 'owner';
  end if;

  update public.profiles
  set campus_affiliation_status = coalesce(p_affiliation_status, campus_affiliation_status),
      owner_verification_status = coalesce(p_owner_status, owner_verification_status),
      primary_role = v_new_role,
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
      'role', v_new_role
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
    'primary_role', v_new_role
  );
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 4. FUNCTION: ASSIGN USER ROLE (Strictly Admins Only)
-- ==============================================================================
create or replace function public.assign_user_role(
  p_target_user_id uuid,
  p_new_role text
)
returns jsonb as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_target record;
  v_clean_role text;
begin
  if v_caller_id is null then
    raise exception 'Authentication required.';
  end if;

  select primary_role into v_caller_role from public.profiles where id = v_caller_id;
  if v_caller_role <> 'admin' then
    raise exception 'Permission denied: Only administrators can assign or revoke roles.';
  end if;

  v_clean_role := lower(trim(coalesce(p_new_role, '')));
  if v_clean_role not in ('borrower', 'owner', 'manager', 'admin') then
    raise exception 'Validation error: Role must be borrower, owner, manager, or admin.';
  end if;

  select * into v_target from public.profiles where id = p_target_user_id;
  if not found then
    raise exception 'Target user profile not found.';
  end if;

  update public.profiles
  set primary_role = v_clean_role,
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
    'admin',
    'profile',
    p_target_user_id,
    'ROLE_ASSIGNED',
    v_target.primary_role,
    v_clean_role,
    'System administrator role assignment.',
    jsonb_build_object(
      'admin_id', v_caller_id,
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
    'Your CampusShare role has been updated to: ' || v_clean_role,
    'role_assign_' || p_target_user_id::text || '_' || v_clean_role
  );

  return jsonb_build_object(
    'success', true,
    'target_user_id', p_target_user_id,
    'new_role', v_clean_role
  );
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 5. FUNCTION: VERIFY QUALIFICATION (Managers & Admins only)
-- ==============================================================================
create or replace function public.verify_qualification(
  p_qualification_id uuid,
  p_status text,
  p_expires_at timestamptz default null
)
returns jsonb as $$
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

  select * into v_qual from public.profile_qualifications where id = p_qualification_id;
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
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 6. PERMISSIONS & FUNCTION SECURITY
-- ==============================================================================
revoke execute on function public.request_owner_verification() from public;
revoke execute on function public.request_affiliation_verification() from public;
revoke execute on function public.verify_user_status(uuid, text, text) from public;
revoke execute on function public.assign_user_role(uuid, text) from public;
revoke execute on function public.verify_qualification(uuid, text, timestamptz) from public;

grant execute on function public.request_owner_verification() to authenticated;
grant execute on function public.request_affiliation_verification() to authenticated;
grant execute on function public.verify_user_status(uuid, text, text) to authenticated;
grant execute on function public.assign_user_role(uuid, text) to authenticated;
grant execute on function public.verify_qualification(uuid, text, timestamptz) to authenticated;
