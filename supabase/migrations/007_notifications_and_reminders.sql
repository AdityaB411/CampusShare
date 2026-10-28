-- ==============================================================================
-- CampusShare Migration 007: 007_notifications_and_reminders.sql
-- Description: Automated due-soon reminders, overdue notification generation,
--              deduplication by booking_id + planned_end / timestamp, and
--              unread notification tracking.
-- Compatible with: Supabase SQL Editor & PostgreSQL 15+
-- ==============================================================================

-- ==============================================================================
-- 1. FUNCTION: GENERATE DEDUPLICATED DUE-SOON & OVERDUE NOTIFICATIONS
-- ==============================================================================
-- Scans active bookings in custody and inserts deduplicated due-soon reminders
-- and overdue notices for borrowers and custodians. Can be called on app load
-- and periodically (every 5 minutes) by active user sessions.
create or replace function public.generate_due_reminders()
returns jsonb as $$
declare
  v_rec record;
  v_res record;
  v_borrower record;
  v_due_soon_key text;
  v_overdue_borrower_key text;
  v_overdue_owner_key text;
  v_due_soon_count int := 0;
  v_overdue_count int := 0;
  v_now timestamptz := now();
begin
  -- 1. Iterate through all bookings currently in active physical custody
  for v_rec in
    select b.id, b.resource_id, b.requester_id, b.status, b.end_time
    from public.bookings b
    where b.status in ('in_use', 'return_pending')
  loop
    select title, owner_id into v_res from public.resources where id = v_rec.resource_id;
    select display_name into v_borrower from public.profiles where id = v_rec.requester_id;

    -- CASE A: DUE SOON (Within 60 minutes of scheduled end and still in_use)
    if v_rec.status = 'in_use' and v_rec.end_time between v_now and (v_now + interval '1 hour') then
      -- Deduplicate by booking_id + scheduled end window
      v_due_soon_key := 'due_soon_' || v_rec.id::text || '_' || to_char(v_rec.end_time, 'YYYYMMDD_HH24MI');

      if not exists (
        select 1 from public.notifications
        where recipient_id = v_rec.requester_id and dedupe_key = v_due_soon_key
      ) then
        insert into public.notifications (
          recipient_id,
          type,
          related_entity_type,
          related_entity_id,
          message,
          dedupe_key
        ) values (
          v_rec.requester_id,
          'due_soon',
          'booking',
          v_rec.id,
          'Reminder: Your custody of "' || coalesce(v_res.title, 'Resource') || '" is due for return by ' || to_char(v_rec.end_time at time zone 'Asia/Kolkata', 'HH24:MI') || ' IST. Please prepare the item for inspection.',
          v_due_soon_key
        );
        v_due_soon_count := v_due_soon_count + 1;
      end if;
    end if;

    -- CASE B: OVERDUE (Past scheduled end time and physical release not confirmed)
    if v_rec.end_time < v_now then
      -- Deduplicate hourly to prevent spam while keeping alerts persistent
      v_overdue_borrower_key := 'overdue_borrower_' || v_rec.id::text || '_' || to_char(v_now, 'YYYYMMDD_HH24');
      v_overdue_owner_key := 'overdue_owner_' || v_rec.id::text || '_' || to_char(v_now, 'YYYYMMDD_HH24');

      -- Notify Borrower
      if not exists (
        select 1 from public.notifications
        where recipient_id = v_rec.requester_id and dedupe_key = v_overdue_borrower_key
      ) then
        insert into public.notifications (
          recipient_id,
          type,
          related_entity_type,
          related_entity_id,
          message,
          dedupe_key
        ) values (
          v_rec.requester_id,
          'overdue',
          'booking',
          v_rec.id,
          'URGENT: Your reservation for "' || coalesce(v_res.title, 'Resource') || '" is overdue (due at ' || to_char(v_rec.end_time at time zone 'Asia/Kolkata', 'HH24:MI') || ' IST). Overdue custody halts subsequent approvals across the campus. Return immediately.',
          v_overdue_borrower_key
        );
        v_overdue_count := v_overdue_count + 1;
      end if;

      -- Notify Resource Custodian
      if v_res.owner_id is not null and not exists (
        select 1 from public.notifications
        where recipient_id = v_res.owner_id and dedupe_key = v_overdue_owner_key
      ) then
        insert into public.notifications (
          recipient_id,
          type,
          related_entity_type,
          related_entity_id,
          message,
          dedupe_key
        ) values (
          v_res.owner_id,
          'overdue',
          'booking',
          v_rec.id,
          'Notice: "' || coalesce(v_res.title, 'Resource') || '" in custody of ' || coalesce(v_borrower.display_name, 'Borrower') || ' is overdue (past scheduled end ' || to_char(v_rec.end_time at time zone 'Asia/Kolkata', 'HH24:MI') || ' IST).',
          v_overdue_owner_key
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'due_soon_generated', v_due_soon_count,
    'overdue_generated', v_overdue_count
  );
end;
$$ language plpgsql security definer set search_path = public;

-- Grant execution to all campus users
grant execute on function public.generate_due_reminders() to authenticated, anon;

-- ==============================================================================
-- 2. FUNCTION: MARK ALL NOTIFICATIONS AS READ
-- ==============================================================================
create or replace function public.mark_all_notifications_as_read()
returns int as $$
declare
  v_user_id uuid := auth.uid();
  v_updated_count int := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  update public.notifications
  set is_read = true
  where recipient_id = v_user_id
    and is_read = false;

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.mark_all_notifications_as_read() to authenticated;

-- ==============================================================================
-- 3. FUNCTION: GET UNREAD NOTIFICATIONS COUNT
-- ==============================================================================
create or replace function public.get_unread_notifications_count()
returns int as $$
declare
  v_user_id uuid := auth.uid();
  v_count int := 0;
begin
  if v_user_id is null then
    return 0;
  end if;

  select count(*) into v_count
  from public.notifications
  where recipient_id = v_user_id
    and is_read = false;

  return v_count;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.get_unread_notifications_count() to authenticated;

-- ==============================================================================
-- 4. MANUAL VERIFICATION TESTS (Run in Supabase SQL Editor)
-- ==============================================================================
/*
-- 4.1 Test reminder generation manually
select public.generate_due_reminders();

-- 4.2 Inspect notifications for recipient
select id, type, message, is_read, dedupe_key, created_at
from public.notifications
order by created_at desc
limit 20;

-- 4.3 Check unread count
select public.get_unread_notifications_count();
*/
