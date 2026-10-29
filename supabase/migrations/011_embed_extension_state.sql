-- CampusShare migration 011: move extension state onto bookings before removing the legacy table.
alter table public.bookings
  add column if not exists extension_status text,
  add column if not exists extension_requested_end_time timestamptz,
  add column if not exists extension_reason text,
  add column if not exists extension_requested_at timestamptz,
  add column if not exists extension_decided_by uuid references public.profiles(id),
  add column if not exists extension_decided_at timestamptz,
  add column if not exists extension_decision_reason text;

do $migrate$
begin
  if to_regclass('public.extension_requests') is not null then
    -- Preserve the most recent request per booking in the booking's current
    -- extension state. Older decisions remain represented in the Trust Record.
    with ranked as (
      select e.*,
             row_number() over (partition by e.booking_id order by e.created_at desc, e.id desc) as rn
        from public.extension_requests e
    )
    update public.bookings b
       set extension_status = e.status,
           extension_requested_end_time = e.new_end_time,
           extension_reason = e.reason,
           extension_requested_at = e.created_at,
           extension_decided_by = e.decided_by,
           extension_decided_at = e.decided_at,
           extension_decision_reason = e.decision_reason
      from ranked e
     where e.booking_id = b.id and e.rn = 1;

    insert into public.activity_events (
      actor_id, actor_role_snapshot, entity_type, entity_id, action,
      previous_state, new_state, reason, metadata, created_at
    )
    select e.requested_by, 'borrower', 'booking', e.booking_id,
           case when e.status = 'pending' then 'EXTENSION_REQUESTED'
                when e.status = 'approved' then 'EXTENSION_APPROVED'
                else 'EXTENSION_REJECTED' end,
           null, e.status, coalesce(e.decision_reason, e.reason),
           jsonb_build_object(
             'legacy_extension_request_id', e.id,
             'requested_end_time', e.new_end_time,
             'requested_by', e.requested_by,
             'requested_at', e.created_at,
             'decided_by', e.decided_by,
             'decided_at', e.decided_at
           ),
           coalesce(e.decided_at, e.created_at)
      from public.extension_requests e
     where not exists (
       select 1 from public.activity_events ae
        where ae.entity_type = 'booking'
          and ae.entity_id = e.booking_id
          and ae.metadata ->> 'legacy_extension_request_id' = e.id::text
     );
  end if;
end;
$migrate$;

alter table public.bookings
  drop constraint if exists bookings_extension_status_check;
alter table public.bookings
  add constraint bookings_extension_status_check
  check (extension_status is null or extension_status in ('pending','approved','rejected'));

create index if not exists bookings_extension_status_created_idx
  on public.bookings (extension_status, extension_requested_at)
  where extension_status = 'pending';
