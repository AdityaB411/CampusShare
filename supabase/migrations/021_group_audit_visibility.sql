-- CampusShare migration 021: let users see their own project-group Trust Record events.
drop policy if exists "Participants and campus staff can read activity events" on public.activity_events;

create policy "Participants and campus staff can read activity events"
on public.activity_events
for select
to authenticated
using (
  actor_id = (select auth.uid())
  or public.is_admin_or_manager()
  or (entity_type = 'profile' and entity_id = (select auth.uid()))
  or (
    entity_type = 'booking'
    and exists (
      select 1
      from public.bookings b
      join public.resources r on r.id = b.resource_id
      where b.id = activity_events.entity_id
        and (
          b.requester_id = (select auth.uid())
          or r.owner_id = (select auth.uid())
          or b.supervisor_user_id = (select auth.uid())
        )
    )
  )
  or (
    entity_type = 'resource'
    and exists (
      select 1 from public.resources r
      where r.id = activity_events.entity_id
        and r.owner_id = (select auth.uid())
    )
  )
  or (
    entity_type = 'incident'
    and exists (
      select 1
      from public.incidents i
      join public.resources r on r.id = i.resource_id
      left join public.bookings b on b.id = i.booking_id
      where i.id = activity_events.entity_id
        and (
          i.reporter_id = (select auth.uid())
          or r.owner_id = (select auth.uid())
          or b.requester_id = (select auth.uid())
          or b.supervisor_user_id = (select auth.uid())
        )
    )
  )
  or (
    entity_type = 'group_membership'
    and metadata ->> 'user_id' = (select auth.uid())::text
  )
  or (
    entity_type = 'project_group'
    and (
      metadata ->> 'created_by' = (select auth.uid())::text
      or exists (
        select 1 from public.group_members gm
        where gm.group_id = activity_events.entity_id
          and gm.user_id = (select auth.uid())
      )
    )
  )
);
