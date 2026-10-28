-- ==============================================================================
-- CampusShare Migration 005: 005_resource_catalogue.sql
-- Description: Public discoverability for published resources, verified owner
--              resource lifecycle (create, edit, archive), and project group
--              management functions for campus managers.
-- Compatible with: Supabase SQL Editor & PostgreSQL 15+
-- ==============================================================================

-- ==============================================================================
-- 1. EXPAND RESOURCE DISCOVERABILITY TO ALL USERS (ANON & AUTHENTICATED)
-- ==============================================================================
drop policy if exists "Published resources are discoverable by signed-in users" on public.resources;
drop policy if exists "Published resources are discoverable by all users" on public.resources;

create policy "Published resources are discoverable by all users"
  on public.resources for select
  to authenticated, anon
  using (
    state = 'published'
    or (auth.uid() is not null and owner_id = auth.uid())
    or (auth.uid() is not null and public.is_admin_or_manager())
  );

-- Ensure verified owners can insert resources
drop policy if exists "Verified owners and staff can create resources" on public.resources;
create policy "Verified owners and staff can create resources"
  on public.resources for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and public.is_verified_owner()
  );

-- Ensure owners and managers can update their resources
drop policy if exists "Owners and managers can update their resources" on public.resources;
create policy "Owners and managers can update their resources"
  on public.resources for update
  to authenticated
  using (
    owner_id = auth.uid()
    or public.is_admin_or_manager()
  )
  with check (
    owner_id = auth.uid()
    or public.is_admin_or_manager()
  );

-- ==============================================================================
-- 2. FUNCTION: ARCHIVE OR PAUSE RESOURCE (Owner or Manager)
-- ==============================================================================
create or replace function public.archive_resource(
  p_resource_id uuid,
  p_new_state text default 'archived'
)
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_resource record;
  v_actor_role text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_new_state not in ('archived', 'paused', 'published', 'draft') then
    raise exception 'Invalid target state: %', p_new_state;
  end if;

  select * into v_resource
  from public.resources
  where id = p_resource_id;

  if not found then
    raise exception 'Resource not found.';
  end if;

  if v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only the owner or an authorized manager can modify resource state.';
  end if;

  -- Block archiving if there are active bookings currently checked out
  if p_new_state in ('archived', 'paused') and exists (
    select 1 from public.bookings
    where resource_id = p_resource_id
      and status in ('in_use', 'return_pending')
  ) then
    raise exception 'Active custody rule: Cannot % a resource with items currently in use or pending return.', p_new_state;
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  update public.resources
  set state = p_new_state,
      updated_at = now()
  where id = p_resource_id;

  -- Audit event in Trust Record
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
    'resource',
    p_resource_id,
    'RESOURCE_STATE_CHANGED',
    v_resource.state,
    p_new_state,
    'Resource state updated by custodian/manager',
    jsonb_build_object('title', v_resource.title)
  );

  return jsonb_build_object('success', true, 'state', p_new_state);
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 3. FUNCTION: CREATE PROJECT GROUP (Borrower or Staff)
-- ==============================================================================
create or replace function public.create_project_group(
  p_name text
)
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_clean_name text;
  v_group_id uuid;
  v_is_staff boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  v_clean_name := trim(coalesce(p_name, ''));
  if length(v_clean_name) < 3 then
    raise exception 'Group name must be at least 3 characters.';
  end if;

  v_is_staff := public.is_admin_or_manager();

  -- Insert project group (auto-verified if created by staff, pending if student)
  insert into public.project_groups (
    name,
    is_verified,
    reviewer_id
  ) values (
    v_clean_name,
    v_is_staff,
    case when v_is_staff then v_user_id else null end
  ) returning id into v_group_id;

  -- Add creator as approved group member
  insert into public.group_members (
    group_id,
    user_id,
    status,
    approved_by
  ) values (
    v_group_id,
    v_user_id,
    'approved',
    case when v_is_staff then v_user_id else null end
  );

  return jsonb_build_object(
    'success', true,
    'group_id', v_group_id,
    'name', v_clean_name,
    'is_verified', v_is_staff
  );
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 4. FUNCTION: VERIFY PROJECT GROUP (Manager or Admin)
-- ==============================================================================
create or replace function public.verify_project_group(
  p_group_id uuid,
  p_is_verified boolean
)
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_group record;
  v_actor_role text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only managers or admins can verify project groups.';
  end if;

  select * into v_group from public.project_groups where id = p_group_id;
  if not found then
    raise exception 'Project group not found.';
  end if;

  select primary_role into v_actor_role from public.profiles where id = v_user_id;

  update public.project_groups
  set is_verified = p_is_verified,
      reviewer_id = v_user_id
  where id = p_group_id;

  -- Audit event in Trust Record
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
    'project_group',
    p_group_id,
    case when p_is_verified then 'GROUP_VERIFIED' else 'GROUP_REVOKED' end,
    v_group.is_verified::text,
    p_is_verified::text,
    'Project group status updated by manager',
    jsonb_build_object('group_name', v_group.name)
  );

  return jsonb_build_object('success', true, 'group_id', p_group_id, 'is_verified', p_is_verified);
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 5. FUNCTION: DECIDE GROUP MEMBERSHIP (Manager or Admin)
-- ==============================================================================
create or replace function public.decide_group_membership(
  p_member_id uuid,
  p_status text
)
returns jsonb as $$
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

  select * into v_member from public.group_members where id = p_member_id;
  if not found then
    raise exception 'Group membership record not found.';
  end if;

  update public.group_members
  set status = p_status,
      approved_by = v_user_id
  where id = p_member_id;

  return jsonb_build_object('success', true, 'member_id', p_member_id, 'status', p_status);
end;
$$ language plpgsql security definer set search_path = public;

-- ==============================================================================
-- 6. GRANT EXECUTE ON NEW FUNCTIONS
-- ==============================================================================
grant execute on function public.archive_resource(uuid, text) to authenticated;
grant execute on function public.create_project_group(text) to authenticated;
grant execute on function public.verify_project_group(uuid, boolean) to authenticated;
grant execute on function public.decide_group_membership(uuid, text) to authenticated;

-- ==============================================================================
-- 7. MANUAL VERIFICATION TESTS (Run in Supabase SQL Editor)
-- ==============================================================================
/*
-- 7.1 Verify public discoverability of published resources
select id, title, type, category, location, state
from public.resources
where state = 'published'
order by created_at desc;

-- 7.2 Verify project groups with reviewer metadata
select pg.id, pg.name, pg.is_verified, p.display_name as reviewer_name
from public.project_groups pg
left join public.profiles p on p.id = pg.reviewer_id;

-- 7.3 Verify group members and approval status
select gm.id, pg.name as group_name, p.display_name as member_name, gm.status
from public.group_members gm
join public.project_groups pg on pg.id = gm.group_id
join public.profiles p on p.id = gm.user_id;
*/
