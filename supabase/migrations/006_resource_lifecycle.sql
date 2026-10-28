-- ==============================================================================
-- CampusShare Migration 006: 006_resource_lifecycle.sql
-- Description: Real-time public physical custody lookup to prevent checked-out
--              resources from appearing available to any campus user, plus
--              incident inspection helpers and timeline read policies.
-- Compatible with: Supabase SQL Editor & PostgreSQL 15+
-- ==============================================================================

-- ==============================================================================
-- 1. FUNCTION: GET ACTIVE RESOURCE CUSTODY (Public / Authenticated)
-- ==============================================================================
-- Allows any campus borrower or visitor to see which resources are physically
-- checked out (in_use or return_pending) and until what time, without leaking
-- private borrower identities, booking purposes, or confidential notes.
create or replace function public.get_active_resource_custody()
returns table (
  resource_id uuid,
  booking_id uuid,
  status text,
  end_time timestamptz
) as $$
begin
  return query
  select
    b.resource_id,
    b.id as booking_id,
    b.status::text,
    b.end_time
  from public.bookings b
  where b.status in ('in_use', 'return_pending');
end;
$$ language plpgsql security definer set search_path = public;

-- Grant execution to all campus users and public visitors
grant execute on function public.get_active_resource_custody() to authenticated, anon;

-- ==============================================================================
-- 2. POLICIES: INCIDENTS ENHANCED SELECT & RESOLUTION PERMISSIONS
-- ==============================================================================
-- Ensure that resource owners can always view and manage incidents filed
-- against their resources, and borrowers can view incidents on their bookings.
drop policy if exists "Involved parties and managers can view incidents" on public.incidents;
create policy "Involved parties and managers can view incidents"
  on public.incidents for select
  to authenticated
  using (
    reporter_id = auth.uid()
    or resource_id in (select id from public.resources where owner_id = auth.uid())
    or booking_id in (select id from public.bookings where requester_id = auth.uid())
    or public.is_admin_or_manager()
  );

-- ==============================================================================
-- 3. FUNCTION: GET BOOKING TIMELINE AUDIT EVENTS
-- ==============================================================================
-- Returns ordered Trust Record activity events for a specific booking
create or replace function public.get_booking_timeline(p_booking_id uuid)
returns table (
  id uuid,
  actor_id uuid,
  actor_name text,
  actor_role_snapshot text,
  action text,
  previous_state text,
  new_state text,
  reason text,
  metadata jsonb,
  created_at timestamptz
) as $$
declare
  v_user_id uuid := auth.uid();
  v_booking record;
  v_resource record;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Booking not found.';
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id;

  -- Security check: User must be requester, resource owner, supervisor, or manager
  if v_booking.requester_id <> v_user_id
     and v_resource.owner_id <> v_user_id
     and coalesce(v_booking.supervisor_user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_user_id
     and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Caller is not authorized to view this booking timeline.';
  end if;

  return query
  select
    ae.id,
    ae.actor_id,
    p.display_name as actor_name,
    ae.actor_role_snapshot,
    ae.action,
    ae.previous_state,
    ae.new_state,
    ae.reason,
    ae.metadata,
    ae.created_at
  from public.activity_events ae
  left join public.profiles p on p.id = ae.actor_id
  where (ae.entity_type = 'booking' and ae.entity_id = p_booking_id)
     or (ae.entity_type = 'incident' and ae.metadata->>'booking_id' = p_booking_id::text)
  order by ae.created_at asc;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.get_booking_timeline(uuid) to authenticated;

-- ==============================================================================
-- 4. MANUAL VERIFICATION TESTS (Run in Supabase SQL Editor)
-- ==============================================================================
/*
-- 4.1 Check all resources currently in active physical custody
select * from public.get_active_resource_custody();

-- 4.2 Check open incidents awaiting custodian/manager review
select i.id, i.type, i.status, r.title as resource_title, p.display_name as reporter, i.created_at
from public.incidents i
join public.resources r on r.id = i.resource_id
join public.profiles p on p.id = i.reporter_id
where i.status in ('open', 'investigating');
*/
