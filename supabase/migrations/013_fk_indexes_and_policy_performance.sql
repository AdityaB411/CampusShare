-- CampusShare migration 013: index missing foreign keys and avoid per-row auth context evaluation.
create index if not exists activity_events_actor_id_idx on public.activity_events(actor_id);
create index if not exists bookings_extension_decided_by_idx on public.bookings(extension_decided_by);
create index if not exists bookings_group_id_idx on public.bookings(group_id);
create index if not exists bookings_initial_acknowledged_by_idx on public.bookings(initial_acknowledged_by);
create index if not exists bookings_return_acknowledged_by_idx on public.bookings(return_acknowledged_by);
create index if not exists group_members_approved_by_idx on public.group_members(approved_by);
create index if not exists incidents_booking_id_idx on public.incidents(booking_id);
create index if not exists incidents_reviewer_id_idx on public.incidents(reviewer_id);
create index if not exists profile_qualifications_verified_by_idx on public.profile_qualifications(verified_by);
create index if not exists profiles_verifier_user_id_idx on public.profiles(verifier_user_id);
create index if not exists project_groups_reviewer_id_idx on public.project_groups(reviewer_id);

drop policy if exists "Users can view their own bookings or bookings of their resource" on public.bookings;
create policy "Users can view their own bookings or bookings of their resource"
  on public.bookings for select to authenticated
  using (
    requester_id = (select auth.uid())
    or resource_id in (select r.id from public.resources r where r.owner_id = (select auth.uid()))
    or supervisor_user_id = (select auth.uid())
    or public.is_admin_or_manager()
  );

drop policy if exists "Group members and staff can view memberships" on public.group_members;
create policy "Group members and staff can view memberships"
  on public.group_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_or_manager());

drop policy if exists "Involved borrowers and owners can report incidents" on public.incidents;
create policy "Involved borrowers and owners can report incidents"
  on public.incidents for insert to authenticated
  with check (reporter_id = (select auth.uid()) or public.is_admin_or_manager());

drop policy if exists "Involved parties and managers can view incidents" on public.incidents;
create policy "Involved parties and managers can view incidents"
  on public.incidents for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or resource_id in (select r.id from public.resources r where r.owner_id = (select auth.uid()))
    or booking_id in (select b.id from public.bookings b where b.requester_id = (select auth.uid()))
    or public.is_admin_or_manager()
  );

drop policy if exists "Owners and managers can review and resolve incidents" on public.incidents;
create policy "Owners and managers can review and resolve incidents"
  on public.incidents for update to authenticated
  using (
    resource_id in (select r.id from public.resources r where r.owner_id = (select auth.uid()))
    or public.is_admin_or_manager()
  )
  with check (
    resource_id in (select r.id from public.resources r where r.owner_id = (select auth.uid()))
    or public.is_admin_or_manager()
  );

drop policy if exists "Users can delete their own notifications" on public.notifications;
create policy "Users can delete their own notifications"
  on public.notifications for delete to authenticated
  using (recipient_id = (select auth.uid()));

drop policy if exists "Users can mark their own notifications as read" on public.notifications;
create policy "Users can mark their own notifications as read"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

drop policy if exists "Users can view their own notifications" on public.notifications;
create policy "Users can view their own notifications"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()) or public.is_admin_or_manager());

drop policy if exists "Verified owners and staff can create resources" on public.resources;
create policy "Verified owners and staff can create resources"
  on public.resources for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.is_verified_owner());
