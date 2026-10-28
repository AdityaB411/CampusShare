-- CampusShare migration 008: security, schema, and Data API reconciliation.
-- Safe to run against the current empty project schema and on clean installs after 001-007.
-- Does not delete application data. Client mutations are routed through validated RPCs.

-- 1. Restore the condition-report table that checkout/return RPCs require.
create table if not exists public.condition_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  phase text not null check (phase in ('start', 'end')),
  condition_code text not null check (condition_code in ('good', 'fair', 'damaged', 'missing_parts')),
  checklist jsonb not null default '{}'::jsonb,
  notes text,
  reporter_id uuid not null references public.profiles(id),
  acknowledged_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_condition_reports_booking
  on public.condition_reports (booking_id);
create index if not exists idx_condition_reports_reporter
  on public.condition_reports (reporter_id);
create index if not exists idx_condition_reports_acknowledged_by
  on public.condition_reports (acknowledged_by);

alter table public.condition_reports enable row level security;

drop policy if exists "Involved parties and managers can view condition reports"
  on public.condition_reports;
create policy "Involved parties and managers can view condition reports"
  on public.condition_reports for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or acknowledged_by = (select auth.uid())
    or public.is_admin_or_manager()
    or exists (
      select 1
      from public.bookings b
      join public.resources r on r.id = b.resource_id
      where b.id = condition_reports.booking_id
        and (
          b.requester_id = (select auth.uid())
          or r.owner_id = (select auth.uid())
          or b.supervisor_user_id = (select auth.uid())
        )
    )
  );

-- 2. Remove direct client write policies for lifecycle/audit tables.
-- Sensitive mutations must go through the checked SECURITY DEFINER business RPCs.
drop policy if exists "Involved parties can update bookings according to role" on public.bookings;
drop policy if exists "Involved parties can update bookings according to role" on public.bookings;
drop policy if exists "Verified borrowers can create bookings" on public.bookings;

drop policy if exists "Authenticated actors and system functions can record events"
  on public.activity_events;
drop policy if exists "Activity events are readable by authenticated users"
  on public.activity_events;
create policy "Participants and campus staff can read activity events"
  on public.activity_events for select to authenticated
  using (
    actor_id = (select auth.uid())
    or public.is_admin_or_manager()
    or (entity_type = 'profile' and entity_id = (select auth.uid()))
    or (
      entity_type = 'booking'
      and exists (
        select 1 from public.bookings b
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
  );

drop policy if exists "System and participants can insert notifications" on public.notifications;

drop policy if exists "Users can request group membership" on public.group_members;
drop policy if exists "Managers and admins can manage project groups" on public.project_groups;

drop policy if exists "Users can submit training credentials" on public.profile_qualifications;
create policy "Users can submit pending training credentials"
  on public.profile_qualifications for insert to authenticated
  with check (
    public.is_admin_or_manager()
    or (
      user_id = (select auth.uid())
      and status = 'pending'
      and verified_by is null
      and verified_at is null
      and expires_at is null
    )
  );

drop policy if exists "Users can view their own training and owners can verify applicants"
  on public.profile_qualifications;
create policy "Users and authorised reviewers can view qualifications"
  on public.profile_qualifications for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin_or_manager()
    or (
      public.is_verified_owner()
      and exists (
        select 1
        from public.bookings b
        join public.resources r on r.id = b.resource_id
        where b.requester_id = profile_qualifications.user_id
          and r.owner_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Owners and managers can update their resources" on public.resources;
drop policy if exists "Users can update their own display name" on public.profiles;

-- Public catalogue access is intentionally limited to published resources.
drop policy if exists "Published resources are discoverable by all users" on public.resources;
drop policy if exists "Published resources are discoverable by signed-in users" on public.resources;
create policy "Public can discover published resources"
  on public.resources for select to anon
  using (state = 'published');
create policy "Authenticated users can discover published and authorised resources"
  on public.resources for select to authenticated
  using (
    state = 'published'
    or owner_id = (select auth.uid())
    or public.is_admin_or_manager()
  );

drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
create policy "Authenticated users can view profiles"
  on public.profiles for select to authenticated
  using (true);
drop policy if exists "Public can view verified owners of published resources" on public.profiles;
create policy "Public can view verified owners of published resources"
  on public.profiles for select to anon
  using (
    primary_role in ('owner', 'manager', 'admin')
    and owner_verification_status = 'verified'
    and exists (
      select 1 from public.resources r
      where r.owner_id = profiles.id and r.state = 'published'
    )
  );

-- 3. Helper functions run as invokers. The authenticated profiles SELECT policy
-- makes role checks possible without turning these helpers into public definer APIs.
create or replace function public.is_admin_or_manager()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and primary_role in ('admin', 'manager')
  );
$$;

create or replace function public.is_verified_owner()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and primary_role in ('owner', 'manager', 'admin')
      and owner_verification_status = 'verified'
  );
$$;

-- 4. Restrict preflight eligibility checks to the current user, campus staff,
-- or the owner of an existing booking for that resource.
create or replace function public.check_borrower_eligibility(
  p_user_id uuid,
  p_resource_id uuid
)
returns table (is_eligible boolean, missing_reason text)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_affiliation text;
  v_required_training text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_user_id is distinct from auth.uid()
     and not public.is_admin_or_manager()
     and not exists (
       select 1
       from public.bookings b
       join public.resources r on r.id = b.resource_id
       where b.requester_id = p_user_id
         and b.resource_id = p_resource_id
         and r.owner_id = (select auth.uid())
     ) then
    raise exception 'Permission denied: eligibility may only be checked for yourself or an assigned booking.';
  end if;

  select p.campus_affiliation_status
    into v_affiliation
  from public.profiles p
  where p.id = p_user_id;

  if not found then
    raise exception 'Profile not found.';
  end if;

  if v_affiliation <> 'verified' then
    return query select false, 'Campus affiliation is not verified';
    return;
  end if;

  select r.required_training_code
    into v_required_training
  from public.resources r
  where r.id = p_resource_id;

  if not found then
    raise exception 'Resource not found.';
  end if;

  if v_required_training is not null and v_required_training <> '' then
    if not exists (
      select 1
      from public.profile_qualifications q
      where q.user_id = p_user_id
        and q.training_code = v_required_training
        and q.status = 'verified'
        and (q.expires_at is null or q.expires_at > now())
    ) then
      return query select false,
        'Missing or expired required prerequisite: ' || v_required_training;
      return;
    end if;
  end if;

  return query select true, null::text;
end;
$$;

-- 5. Supervised checkout requires the real assigned supervisor, verified owner,
-- or authorised manager/admin to perform the confirmation. A borrower-supplied
-- boolean alone can never satisfy the gate.
create or replace function public.confirm_checkout(
  p_booking_id uuid,
  p_condition_code text,
  p_checklist jsonb default '{}'::jsonb,
  p_notes text default null,
  p_supervisor_confirmation boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_resource public.resources%rowtype;
  v_actor_role text;
  v_clean_condition text;
  v_is_supervisor_confirmed boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  v_clean_condition := lower(trim(coalesce(p_condition_code, '')));
  if v_clean_condition not in ('good', 'fair', 'damaged', 'missing_parts') then
    raise exception 'Validation error: Initial condition code must be good, fair, damaged, or missing_parts.';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.status <> 'approved' then
    raise exception 'Invalid transition: Only approved bookings can complete checkout (current status: %).', v_booking.status;
  end if;

  select * into v_resource
  from public.resources
  where id = v_booking.resource_id
  for update;

  select p.primary_role into v_actor_role
  from public.profiles p
  where p.id = v_user_id;

  if v_booking.requester_id <> v_user_id
     and v_resource.owner_id <> v_user_id
     and coalesce(v_booking.supervisor_user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_user_id
     and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Caller is not a participant in this booking.';
  end if;

  if v_resource.requires_supervision then
    if v_booking.supervisor_user_id is null then
      raise exception 'Supervision gate: A named, authorised supervisor is required before checkout.';
    end if;

    if v_user_id <> v_booking.supervisor_user_id
       and v_user_id <> v_resource.owner_id
       and not public.is_admin_or_manager() then
      raise exception 'Supervision gate: The assigned supervisor, resource owner, or authorised manager must confirm checkout.';
    end if;

    if not coalesce(p_supervisor_confirmation, false) then
      raise exception 'Supervision gate: The authorised supervisor must explicitly confirm presence.';
    end if;

    v_is_supervisor_confirmed := true;
  end if;

  update public.bookings
  set status = 'in_use',
      actual_start_at = now(),
      initial_condition_code = v_clean_condition,
      initial_condition_checklist = coalesce(p_checklist, '{}'::jsonb),
      initial_condition_notes = p_notes,
      initial_acknowledged_by = v_user_id,
      initial_acknowledged_at = now(),
      updated_at = now()
  where id = p_booking_id;

  insert into public.condition_reports (
    booking_id, phase, condition_code, checklist, notes, reporter_id, acknowledged_by
  ) values (
    p_booking_id, 'start', v_clean_condition,
    coalesce(p_checklist, '{}'::jsonb), p_notes, v_booking.requester_id, v_user_id
  );

  insert into public.activity_events (
    actor_id, actor_role_snapshot, entity_type, entity_id, action,
    previous_state, new_state, reason, metadata
  ) values (
    v_user_id, coalesce(v_actor_role, 'borrower'), 'booking', p_booking_id,
    'CHECKOUT_COMPLETED', 'approved', 'in_use',
    'Initial condition checklist verified and custody handed off.',
    jsonb_build_object(
      'resource_title', v_resource.title,
      'condition_code', v_clean_condition,
      'supervised', v_resource.requires_supervision,
      'supervisor_confirmed', v_is_supervisor_confirmed
    )
  );

  insert into public.notifications (
    recipient_id, type, related_entity_type, related_entity_id, message, dedupe_key
  ) values (
    case when v_user_id = v_booking.requester_id then v_resource.owner_id else v_booking.requester_id end,
    'general', 'booking', p_booking_id,
    'Custody started for "' || v_resource.title || '". Initial condition: ' || v_clean_condition || '.',
    'checkout_' || p_booking_id::text
  )
  on conflict do nothing;

  return jsonb_build_object(
    'success', true, 'booking_id', p_booking_id,
    'status', 'in_use', 'initial_condition', v_clean_condition
  );
end;
$$;

-- 6. Incident reports must belong to the supplied resource/booking, and the
-- caller must be a booking participant or the resource owner/staff.
create or replace function public.report_incident(
  p_resource_id uuid,
  p_booking_id uuid,
  p_type text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clean_type text := lower(trim(coalesce(p_type, '')));
  v_clean_description text := trim(coalesce(p_description, ''));
  v_resource public.resources%rowtype;
  v_booking public.bookings%rowtype;
  v_actor_role text;
  v_incident_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if v_clean_type not in ('damage', 'delay', 'conflict', 'custody_mismatch', 'other') then
    raise exception 'Validation error: Invalid incident type.';
  end if;
  if length(v_clean_description) = 0 then
    raise exception 'Validation error: Incident description is mandatory.';
  end if;

  select * into v_resource
  from public.resources
  where id = p_resource_id;
  if not found then
    raise exception 'Resource not found.';
  end if;

  if p_booking_id is not null then
    select * into v_booking
    from public.bookings
    where id = p_booking_id and resource_id = p_resource_id;
    if not found then
      raise exception 'Booking/resource mismatch: incident must reference a booking for this resource.';
    end if;

    if v_booking.requester_id <> v_user_id
       and v_resource.owner_id <> v_user_id
       and coalesce(v_booking.supervisor_user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_user_id
       and not public.is_admin_or_manager() then
      raise exception 'Permission denied: Caller is not a participant in this booking.';
    end if;
  elsif v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: A booking or authorised resource owner is required to report an incident.';
  end if;

  select p.primary_role into v_actor_role
  from public.profiles p where p.id = v_user_id;

  insert into public.incidents (
    booking_id, resource_id, type, description, status, reporter_id
  ) values (
    p_booking_id, p_resource_id, v_clean_type, v_clean_description, 'open', v_user_id
  ) returning id into v_incident_id;

  insert into public.activity_events (
    actor_id, actor_role_snapshot, entity_type, entity_id, action,
    previous_state, new_state, reason, metadata
  ) values (
    v_user_id, coalesce(v_actor_role, 'borrower'), 'incident', v_incident_id,
    'INCIDENT_REPORTED', null, 'open', v_clean_description,
    jsonb_build_object(
      'resource_title', v_resource.title,
      'incident_type', v_clean_type,
      'booking_id', p_booking_id
    )
  );

  insert into public.notifications (
    recipient_id, type, related_entity_type, related_entity_id, message, dedupe_key
  ) values (
    v_resource.owner_id, 'incident', 'incident', v_incident_id,
    'Incident reported (' || v_clean_type || ') for "' || v_resource.title || '": ' || v_clean_description,
    'incident_rep_' || v_incident_id::text
  )
  on conflict do nothing;

  return jsonb_build_object(
    'success', true, 'incident_id', v_incident_id,
    'type', v_clean_type, 'status', 'open'
  );
end;
$$;

-- 7. Update resource fields and state atomically. The state transition shares the
-- same custody guard and audit trail as archive_resource().
create or replace function public.update_resource(
  p_resource_id uuid,
  p_title text,
  p_type text,
  p_category text,
  p_summary text,
  p_location_label text,
  p_max_duration_hours integer,
  p_rules text,
  p_required_training_code text,
  p_requires_supervision boolean,
  p_new_state text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_resource public.resources%rowtype;
  v_updated public.resources%rowtype;
  v_actor_role text;
  v_training text := nullif(upper(trim(coalesce(p_required_training_code, ''))), '');
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if length(trim(coalesce(p_title, ''))) = 0
     or length(trim(coalesce(p_category, ''))) = 0
     or length(trim(coalesce(p_summary, ''))) = 0
     or length(trim(coalesce(p_location_label, ''))) = 0 then
    raise exception 'Validation error: Title, category, summary, and location are required.';
  end if;
  if p_type not in ('equipment', 'space') then
    raise exception 'Validation error: Resource type must be equipment or space.';
  end if;
  if p_max_duration_hours is null or p_max_duration_hours <= 0 then
    raise exception 'Validation error: Maximum duration hours must be positive.';
  end if;
  if p_new_state not in ('draft', 'published', 'paused', 'archived') then
    raise exception 'Validation error: Invalid resource state.';
  end if;

  select * into v_resource
  from public.resources
  where id = p_resource_id
  for update;
  if not found then
    raise exception 'Resource not found.';
  end if;

  if v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only the resource owner or authorised campus staff can edit this resource.';
  end if;
  if not public.is_admin_or_manager() and not public.is_verified_owner() then
    raise exception 'Permission denied: Resource owner verification is required.';
  end if;

  if p_new_state in ('paused', 'archived')
     and exists (
       select 1 from public.bookings b
       where b.resource_id = p_resource_id
         and b.status in ('in_use', 'return_pending')
         and b.actual_release_confirmed_at is null
     ) then
    raise exception 'Active custody rule: Cannot pause or archive a resource until physical hand-back is confirmed.';
  end if;

  select p.primary_role into v_actor_role
  from public.profiles p where p.id = v_user_id;

  update public.resources
  set title = trim(p_title),
      type = p_type,
      category = trim(p_category),
      summary = trim(p_summary),
      location_label = trim(p_location_label),
      max_duration_hours = p_max_duration_hours,
      rules = nullif(trim(coalesce(p_rules, '')), ''),
      required_training_code = v_training,
      requires_supervision = coalesce(p_requires_supervision, false),
      state = p_new_state,
      updated_at = now()
  where id = p_resource_id
  returning * into v_updated;

  if v_resource.state is distinct from v_updated.state then
    insert into public.activity_events (
      actor_id, actor_role_snapshot, entity_type, entity_id, action,
      previous_state, new_state, reason, metadata
    ) values (
      v_user_id, coalesce(v_actor_role, 'owner'), 'resource', p_resource_id,
      'RESOURCE_STATE_CHANGED', v_resource.state, v_updated.state,
      'Resource state updated by authorised owner or campus staff.',
      jsonb_build_object('title', v_updated.title)
    );
  end if;

  return to_jsonb(v_updated);
end;
$$;

-- 8. Audit resource creation and metadata changes atomically.
create or replace function public.audit_resource_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
begin
  select p.primary_role into v_actor_role
  from public.profiles p where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    insert into public.activity_events (
      actor_id, actor_role_snapshot, entity_type, entity_id, action,
      previous_state, new_state, reason, metadata
    ) values (
      v_actor_id, coalesce(v_actor_role, 'system'), 'resource', new.id,
      'RESOURCE_CREATED', null, new.state,
      'Resource listing created by an authorised owner.',
      jsonb_build_object('title', new.title, 'type', new.type, 'category', new.category)
    );
    return new;
  end if;

  insert into public.activity_events (
    actor_id, actor_role_snapshot, entity_type, entity_id, action,
    previous_state, new_state, reason, metadata
  ) values (
    v_actor_id, coalesce(v_actor_role, 'system'), 'resource', new.id,
    'RESOURCE_DETAILS_UPDATED', old.state, new.state,
    'Resource details updated by an authorised owner or campus staff.',
    jsonb_build_object('title', new.title, 'type', new.type, 'category', new.category)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_resource_created on public.resources;
create trigger trg_audit_resource_created
  after insert on public.resources
  for each row execute function public.audit_resource_mutation();

drop trigger if exists trg_audit_resource_details_updated on public.resources;
create trigger trg_audit_resource_details_updated
  after update of title, type, category, summary, location_label, max_duration_hours,
    rules, required_training_code, requires_supervision
  on public.resources
  for each row execute function public.audit_resource_mutation();

-- 9. Guard status changes even if a future server path adds a direct UPDATE grant.
create or replace function public.guard_booking_status_updates()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_resource public.resources%rowtype;
  v_eligible boolean;
  v_missing_reason text;
  v_supervisor_role text;
  v_supervisor_owner_status text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'approved' then
    if old.status not in ('pending_owner_review', 'waitlisted', 'pending_verification') then
      raise exception 'Invalid transition: cannot approve booking from status %.', old.status;
    end if;

    select * into v_resource
    from public.resources r
    where r.id = new.resource_id;
    if not found or v_resource.state <> 'published' then
      raise exception 'Approval blocked: resource is not published and accepting requests.';
    end if;

    select e.is_eligible, e.missing_reason
      into v_eligible, v_missing_reason
    from public.check_borrower_eligibility(new.requester_id, new.resource_id) e;
    if not coalesce(v_eligible, false) then
      raise exception 'Approval blocked by eligibility gate: %', coalesce(v_missing_reason, 'eligibility could not be verified');
    end if;

    if v_resource.requires_supervision and new.supervisor_user_id is null then
      raise exception 'Supervision gate: A named authorised supervisor is required before approval.';
    end if;

    if v_resource.requires_supervision then
      select p.primary_role, p.owner_verification_status
        into v_supervisor_role, v_supervisor_owner_status
      from public.profiles p
      where p.id = new.supervisor_user_id;

      if not found
         or v_supervisor_role not in ('owner', 'manager', 'admin')
         or (v_supervisor_role = 'owner' and v_supervisor_owner_status <> 'verified') then
        raise exception 'Supervision gate: Assigned supervisor must be a verified owner, manager, or administrator.';
      end if;
    end if;

    if exists (
      select 1 from public.bookings b
      where b.resource_id = new.resource_id
        and b.id <> new.id
        and b.status in ('in_use', 'return_pending')
        and b.actual_release_confirmed_at is null
    ) then
      raise exception 'Active custody blocker: Hand-back must be confirmed before another approval.';
    end if;

    if exists (
      select 1 from public.bookings b
      where b.resource_id = new.resource_id
        and b.id <> new.id
        and b.status in ('approved', 'in_use', 'return_pending')
        and b.start_time < new.end_time
        and b.end_time > new.start_time
    ) then
      raise exception 'Scheduling conflict: The requested interval overlaps an active or approved booking.';
    end if;
  elsif new.status = 'waitlisted' then
    if old.status not in ('pending_owner_review', 'pending_verification') then
      raise exception 'Invalid transition: cannot waitlist booking from status %.', old.status;
    end if;

    select * into v_resource from public.resources r where r.id = new.resource_id;
    select e.is_eligible, e.missing_reason
      into v_eligible, v_missing_reason
    from public.check_borrower_eligibility(new.requester_id, new.resource_id) e;
    if not coalesce(v_eligible, false) then
      raise exception 'Waitlisting blocked: only eligible requests can enter the FIFO queue (%).', coalesce(v_missing_reason, 'eligibility could not be verified');
    end if;

    if auth.uid() = new.requester_id
       and v_resource.owner_id <> (select auth.uid())
       and not public.is_admin_or_manager() then
      raise exception 'Permission denied: only the resource owner or authorised campus staff may waitlist a request.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_booking_status_updates on public.bookings;
create trigger trg_guard_booking_status_updates
  before update of status on public.bookings
  for each row execute function public.guard_booking_status_updates();

-- 10. Set a fixed, safe search_path for every existing SECURITY DEFINER function.
do $$
declare
  f record;
begin
  for f in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = pg_catalog, public',
      f.nspname, f.proname, f.identity_args
    );
  end loop;
end;
$$;

-- The append-only trigger has no need to resolve objects outside pg_catalog.
alter function public.prevent_audit_tampering() set search_path = pg_catalog;

-- 11. Revoke inherited/default access, then add only the privileges required by
-- the frontend. RLS is still the row-level boundary for every exposed table.
revoke all privileges on all tables in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

grant select on public.resources to anon, authenticated;
grant insert (
  type, category, title, summary, location_label, owner_id, state,
  max_duration_hours, rules, required_training_code, requires_supervision, updated_at
) on public.resources to authenticated;

grant select (id, display_name, primary_role, owner_verification_status)
  on public.profiles to anon;
grant select on public.profiles to authenticated;

grant select (id, resource_id, status, end_time)
  on public.bookings to anon;
grant select on public.bookings to authenticated;

grant select on public.project_groups to authenticated;
grant select on public.group_members to authenticated;
grant select, insert on public.profile_qualifications to authenticated;
grant select on public.extension_requests to authenticated;
grant select on public.incidents to authenticated;
grant select on public.condition_reports to authenticated;
grant select on public.activity_events to authenticated;
grant select on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;

-- 12. The active-custody reader exposes only status/timing identifiers and is
-- the sole intentionally public SECURITY DEFINER read function.
create or replace function public.get_active_resource_custody()
returns table (
  resource_id uuid,
  booking_id uuid,
  status text,
  end_time timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  select b.resource_id, b.id, b.status, b.end_time
  from public.bookings b
  where b.status in ('in_use', 'return_pending');
end;
$$;

-- Recreate the timeline function as SECURITY INVOKER; its table grants and RLS
-- already limit it to booking participants and campus staff.
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
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_resource public.resources%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Booking not found or not visible to caller.';
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id;

  if v_booking.requester_id <> v_user_id
     and v_resource.owner_id <> v_user_id
     and coalesce(v_booking.supervisor_user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_user_id
     and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Caller is not authorised to view this booking timeline.';
  end if;

  return query
  select ae.id, ae.actor_id, p.display_name, ae.actor_role_snapshot,
    ae.action, ae.previous_state, ae.new_state, ae.reason, ae.metadata, ae.created_at
  from public.activity_events ae
  left join public.profiles p on p.id = ae.actor_id
  where (ae.entity_type = 'booking' and ae.entity_id = p_booking_id)
     or (ae.entity_type = 'incident' and ae.metadata->>'booking_id' = p_booking_id::text)
  order by ae.created_at asc;
end;
$$;

create or replace function public.get_unread_notifications_count()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user_id is null then
    return 0;
  end if;

  select count(*) into v_count
  from public.notifications
  where recipient_id = v_user_id and is_read = false;
  return v_count;
end;
$$;

create or replace function public.mark_all_notifications_as_read()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  update public.notifications
  set is_read = true
  where recipient_id = v_user_id and is_read = false;

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

-- 13. Revoke default PUBLIC/anon execution for every public function, then grant
-- only the user-facing operations. Trigger functions remain non-callable via RPC.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_admin_or_manager() to authenticated;
grant execute on function public.is_verified_owner() to authenticated;
grant execute on function public.check_borrower_eligibility(uuid, uuid) to authenticated;
grant execute on function public.submit_booking_request(uuid, timestamptz, timestamptz, text, uuid, uuid) to authenticated;
grant execute on function public.approve_booking_request(uuid, text, uuid) to authenticated;
grant execute on function public.reject_booking_request(uuid, text) to authenticated;
grant execute on function public.waitlist_booking_request(uuid, text) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.request_booking_extension(uuid, timestamptz, text) to authenticated;
grant execute on function public.decide_booking_extension(uuid, text, text) to authenticated;
grant execute on function public.confirm_checkout(uuid, text, jsonb, text, boolean) to authenticated;
grant execute on function public.submit_return(uuid, text, jsonb, text) to authenticated;
grant execute on function public.confirm_return(uuid, text, boolean) to authenticated;
grant execute on function public.report_incident(uuid, uuid, text, text) to authenticated;
grant execute on function public.resolve_incident(uuid, text, text) to authenticated;
grant execute on function public.request_owner_verification() to authenticated;
grant execute on function public.request_affiliation_verification() to authenticated;
grant execute on function public.verify_user_status(uuid, text, text) to authenticated;
grant execute on function public.assign_user_role(uuid, text) to authenticated;
grant execute on function public.verify_qualification(uuid, text, timestamptz) to authenticated;
grant execute on function public.archive_resource(uuid, text) to authenticated;
grant execute on function public.update_resource(uuid, text, text, text, text, text, integer, text, text, boolean, text) to authenticated;
grant execute on function public.create_project_group(text) to authenticated;
grant execute on function public.verify_project_group(uuid, boolean) to authenticated;
grant execute on function public.decide_group_membership(uuid, text) to authenticated;
grant execute on function public.get_active_resource_custody() to anon, authenticated;
grant execute on function public.get_booking_timeline(uuid) to authenticated;
grant execute on function public.get_unread_notifications_count() to authenticated;
grant execute on function public.mark_all_notifications_as_read() to authenticated;

-- Do not grant generate_due_reminders to anon or authenticated: migration 009
-- installs the scheduled database job, which runs as the trusted job owner.
