-- ==============================================================================
-- CampusShare Core Schema Migration: 001_core_schema.sql
-- Description: Core tables, constraints, indexes, elevation protections,
--              audit integrity triggers, and role-based Row Level Security (RLS).
-- Compatible with: Supabase SQL Editor & PostgreSQL 15+
-- ==============================================================================

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ==============================================================================
-- 2. TABLES (Created in foreign-key dependency order)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 2.1 PROFILES TABLE
-- ------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  primary_role text not null check (primary_role in ('borrower', 'owner', 'manager', 'admin')) default 'borrower',
  campus_affiliation_status text not null check (campus_affiliation_status in ('verified', 'pending', 'unverified')) default 'unverified',
  owner_verification_status text not null check (owner_verification_status in ('verified', 'pending', 'unverified')) default 'unverified',
  verifier_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles (primary_role);
create index if not exists idx_profiles_affiliation on public.profiles (campus_affiliation_status);
create index if not exists idx_profiles_owner_verif on public.profiles (owner_verification_status);

-- ------------------------------------------------------------------------------
-- 2.2 RESOURCES TABLE (Equipment & Reservable Spaces)
-- ------------------------------------------------------------------------------
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('equipment', 'space')),
  category text not null,
  title text not null,
  summary text not null,
  location_label text not null,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  state text not null check (state in ('draft', 'published', 'paused', 'archived')) default 'draft',
  max_duration_hours integer not null check (max_duration_hours > 0),
  rules text,
  required_training_code text,
  requires_supervision boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_resources_state_type on public.resources (state, type);
create index if not exists idx_resources_owner on public.resources (owner_id);
create index if not exists idx_resources_training on public.resources (required_training_code);

-- ------------------------------------------------------------------------------
-- 2.3 PROJECT GROUPS & MEMBERSHIP
-- ------------------------------------------------------------------------------
create table if not exists public.project_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_verified boolean not null default false,
  reviewer_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.project_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('approved', 'pending', 'removed')) default 'pending',
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists idx_group_members_user on public.group_members (user_id, status);
create index if not exists idx_group_members_group on public.group_members (group_id, status);

-- ------------------------------------------------------------------------------
-- 2.4 PROFILE QUALIFICATIONS (Training / Certifications)
-- ------------------------------------------------------------------------------
create table if not exists public.profile_qualifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  training_code text not null,
  status text not null check (status in ('verified', 'pending', 'expired', 'revoked')) default 'pending',
  expires_at timestamptz,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, training_code)
);

create index if not exists idx_qualifications_user on public.profile_qualifications (user_id, training_code, status);

-- ------------------------------------------------------------------------------
-- 2.5 BOOKINGS TABLE (Status, Custody, Initial/Return Condition)
-- ------------------------------------------------------------------------------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete restrict,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.project_groups(id) on delete set null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  purpose text not null,
  status text not null check (
    status in (
      'pending_verification',
      'pending_owner_review',
      'waitlisted',
      'approved',
      'in_use',
      'return_pending',
      'returned',
      'rejected',
      'cancelled'
    )
  ) default 'pending_verification',
  supervisor_user_id uuid references public.profiles(id),
  actual_start_at timestamptz,
  actual_release_confirmed_at timestamptz,
  decision_reason text,

  -- Initial Condition Check at Handoff / Checkout
  initial_condition_code text check (initial_condition_code in ('good', 'fair', 'damaged', 'missing_parts')),
  initial_condition_checklist jsonb default '{}'::jsonb,
  initial_condition_notes text,
  initial_acknowledged_by uuid references public.profiles(id),
  initial_acknowledged_at timestamptz,

  -- Return Condition Check upon Hand-Back
  return_condition_code text check (return_condition_code in ('good', 'fair', 'damaged', 'missing_parts')),
  return_condition_checklist jsonb default '{}'::jsonb,
  return_condition_notes text,
  return_acknowledged_by uuid references public.profiles(id),
  return_acknowledged_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Logical constraint: end time must be strictly after start time
  constraint chk_booking_interval check (end_time > start_time)
);

create index if not exists idx_bookings_resource_schedule on public.bookings (resource_id, start_time, end_time, status);
create index if not exists idx_bookings_requester on public.bookings (requester_id, status);
create index if not exists idx_bookings_supervisor on public.bookings (supervisor_user_id);
create index if not exists idx_bookings_active_custody on public.bookings (resource_id, status) where status in ('in_use', 'return_pending');

-- ------------------------------------------------------------------------------
-- 2.6 CONDITION REPORTS TABLE (Handoff & Return Physical Condition Reports)
-- ------------------------------------------------------------------------------
create table if not exists public.condition_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  phase text not null check (phase in ('start', 'end')),
  condition_code text not null check (condition_code in ('good', 'fair', 'damaged', 'missing_parts')),
  checklist jsonb default '{}'::jsonb,
  notes text,
  reporter_id uuid not null references public.profiles(id),
  acknowledged_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_condition_reports_booking on public.condition_reports (booking_id);
create index if not exists idx_condition_reports_reporter on public.condition_reports (reporter_id);

-- ------------------------------------------------------------------------------
-- 2.7 EXTENSION REQUESTS TABLE
-- ------------------------------------------------------------------------------
create table if not exists public.extension_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  new_end_time timestamptz not null,
  reason text not null,
  status text not null check (status in ('pending', 'approved', 'rejected')) default 'pending',
  decided_by uuid references public.profiles(id),
  decision_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists idx_extension_requests_booking on public.extension_requests (booking_id, status);

-- ------------------------------------------------------------------------------
-- 2.7 INCIDENTS TABLE
-- ------------------------------------------------------------------------------
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  resource_id uuid not null references public.resources(id) on delete cascade,
  type text not null check (type in ('damage', 'delay', 'conflict', 'custody_mismatch', 'other')),
  description text not null,
  status text not null check (status in ('open', 'investigating', 'resolved')) default 'open',
  reporter_id uuid not null references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_incidents_resource on public.incidents (resource_id, status);
create index if not exists idx_incidents_reporter on public.incidents (reporter_id);

-- ------------------------------------------------------------------------------
-- 2.8 ACTIVITY EVENTS TABLE (Append-Only Trust Record)
-- ------------------------------------------------------------------------------
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role_snapshot text not null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  previous_state text,
  new_state text,
  reason text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_events_entity on public.activity_events (entity_type, entity_id);
create index if not exists idx_activity_events_created on public.activity_events (created_at desc);

-- ------------------------------------------------------------------------------
-- 2.9 NOTIFICATIONS TABLE
-- ------------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('approval', 'rejection', 'due_soon', 'overdue', 'incident', 'general')),
  related_entity_type text,
  related_entity_id uuid,
  message text not null,
  is_read boolean not null default false,
  dedupe_key text,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient on public.notifications (recipient_id, is_read, created_at desc);
create index if not exists idx_notifications_dedupe on public.notifications (recipient_id, dedupe_key) where dedupe_key is not null;

-- ==============================================================================
-- 3. HELPER FUNCTIONS FOR SECURITY & ROLES (Defined after public.profiles exists)
-- ==============================================================================

-- Checks if the authenticated user is an admin or manager without recursion
create or replace function public.is_admin_or_manager()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and primary_role in ('admin', 'manager')
  );
$$ language sql stable security definer set search_path = public;

-- Checks if user is an approved/verified owner
create or replace function public.is_verified_owner()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and primary_role in ('owner', 'manager', 'admin')
      and owner_verification_status = 'verified'
  );
$$ language sql stable security definer set search_path = public;

-- ==============================================================================
-- 4. TRIGGERS: AUTOMATIC SIGNUP, PRIVILEGE ELEVATION PROTECTION, AUDIT INTEGRITY
-- ==============================================================================

-- Auto-provision new users into public.profiles as borrower + unverified
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (
    id,
    display_name,
    primary_role,
    campus_affiliation_status,
    owner_verification_status
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'Campus User'),
    'borrower',
    'unverified',
    'unverified'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Drop trigger if already exists and rebind
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger to prevent unauthorized privilege and verification elevation
create or replace function public.check_profile_elevation()
returns trigger as $$
begin
  -- Allow service role or background admin tasks (auth.uid() is null in direct system operations)
  if auth.uid() is null then
    return new;
  end if;

  -- Disallow modifying protected fields if caller is not an admin or manager
  if (old.primary_role is distinct from new.primary_role
      or old.campus_affiliation_status is distinct from new.campus_affiliation_status
      or old.owner_verification_status is distinct from new.owner_verification_status
      or old.verifier_user_id is distinct from new.verifier_user_id) then

    if not public.is_admin_or_manager() then
      raise exception 'Security violation: Users cannot elevate their own role or verification status.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_prevent_profile_elevation on public.profiles;
create trigger trg_prevent_profile_elevation
  before update on public.profiles
  for each row execute function public.check_profile_elevation();

-- Trigger to enforce append-only immutable Trust Record (activity_events)
create or replace function public.prevent_audit_tampering()
returns trigger as $$
begin
  raise exception 'Append-only Trust Record violation: Audit events cannot be modified or deleted.';
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_protect_activity_events on public.activity_events;
create trigger trg_protect_activity_events
  before update or delete on public.activity_events
  for each row execute function public.prevent_audit_tampering();

-- ==============================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Enable RLS across every single table
alter table public.profiles enable row level security;
alter table public.resources enable row level security;
alter table public.project_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.profile_qualifications enable row level security;
alter table public.bookings enable row level security;
alter table public.condition_reports enable row level security;
alter table public.extension_requests enable row level security;
alter table public.incidents enable row level security;
alter table public.activity_events enable row level security;
alter table public.notifications enable row level security;

-- ------------------------------------------------------------------------------
-- 5.1 PROFILES RLS
-- ------------------------------------------------------------------------------
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update their own display name"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id or public.is_admin_or_manager())
  with check (auth.uid() = id or public.is_admin_or_manager());

-- ------------------------------------------------------------------------------
-- 5.2 RESOURCES RLS
-- ------------------------------------------------------------------------------
create policy "Published resources are discoverable by signed-in users"
  on public.resources for select
  to authenticated
  using (
    state = 'published'
    or owner_id = auth.uid()
    or public.is_admin_or_manager()
  );

create policy "Verified owners and staff can create resources"
  on public.resources for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and public.is_verified_owner()
  );

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

-- ------------------------------------------------------------------------------
-- 5.3 PROJECT GROUPS & MEMBERS RLS
-- ------------------------------------------------------------------------------
create policy "Verified groups are viewable by authenticated users"
  on public.project_groups for select
  to authenticated
  using (is_verified = true or public.is_admin_or_manager());

create policy "Managers and admins can manage project groups"
  on public.project_groups for all
  to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

create policy "Group members and staff can view memberships"
  on public.group_members for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin_or_manager());

create policy "Users can request group membership"
  on public.group_members for insert
  to authenticated
  with check (user_id = auth.uid() or public.is_admin_or_manager());

create policy "Managers can approve or update membership"
  on public.group_members for update
  to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

-- ------------------------------------------------------------------------------
-- 5.4 PROFILE QUALIFICATIONS RLS
-- ------------------------------------------------------------------------------
create policy "Users can view their own training and owners can verify applicants"
  on public.profile_qualifications for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_verified_owner()
    or public.is_admin_or_manager()
  );

create policy "Users can submit training credentials"
  on public.profile_qualifications for insert
  to authenticated
  with check (user_id = auth.uid() or public.is_admin_or_manager());

create policy "Only managers and admins can verify qualifications"
  on public.profile_qualifications for update
  to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

-- ------------------------------------------------------------------------------
-- 5.5 BOOKINGS RLS
-- ------------------------------------------------------------------------------
create policy "Users can view their own bookings or bookings of their resources"
  on public.bookings for select
  to authenticated
  using (
    requester_id = auth.uid()
    or resource_id in (select id from public.resources where owner_id = auth.uid())
    or supervisor_user_id = auth.uid()
    or public.is_admin_or_manager()
  );

create policy "Verified borrowers can create bookings"
  on public.bookings for insert
  to authenticated
  with check (
    requester_id = auth.uid()
  );

create policy "Involved parties can update bookings according to role"
  on public.bookings for update
  to authenticated
  using (
    requester_id = auth.uid()
    or resource_id in (select id from public.resources where owner_id = auth.uid())
    or supervisor_user_id = auth.uid()
    or public.is_admin_or_manager()
  )
  with check (
    requester_id = auth.uid()
    or resource_id in (select id from public.resources where owner_id = auth.uid())
    or supervisor_user_id = auth.uid()
    or public.is_admin_or_manager()
  );

-- ------------------------------------------------------------------------------
-- 5.6 EXTENSION REQUESTS RLS
-- ------------------------------------------------------------------------------
create policy "Involved booking parties can view extension requests"
  on public.extension_requests for select
  to authenticated
  using (
    requested_by = auth.uid()
    or booking_id in (
      select b.id from public.bookings b
      join public.resources r on b.resource_id = r.id
      where r.owner_id = auth.uid()
    )
    or public.is_admin_or_manager()
  );

create policy "Borrowers can submit extension requests"
  on public.extension_requests for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and booking_id in (select id from public.bookings where requester_id = auth.uid())
  );

create policy "Owners and managers can decide extension requests"
  on public.extension_requests for update
  to authenticated
  using (
    booking_id in (
      select b.id from public.bookings b
      join public.resources r on b.resource_id = r.id
      where r.owner_id = auth.uid()
    )
    or public.is_admin_or_manager()
  );

-- ------------------------------------------------------------------------------
-- 5.7 CONDITION REPORTS RLS
-- ------------------------------------------------------------------------------
create policy "Involved parties and managers can view condition reports"
  on public.condition_reports for select
  to authenticated
  using (
    reporter_id = auth.uid()
    or acknowledged_by = auth.uid()
    or booking_id in (
      select b.id from public.bookings b
      join public.resources r on b.resource_id = r.id
      where b.requester_id = auth.uid()
         or r.owner_id = auth.uid()
         or b.supervisor_user_id = auth.uid()
    )
    or public.is_admin_or_manager()
  );

create policy "Involved parties and managers can insert condition reports"
  on public.condition_reports for insert
  to authenticated
  with check (
    reporter_id = auth.uid()
    or public.is_admin_or_manager()
  );

create policy "Managers and custodians can acknowledge condition reports"
  on public.condition_reports for update
  to authenticated
  using (
    acknowledged_by = auth.uid()
    or booking_id in (
      select b.id from public.bookings b
      join public.resources r on b.resource_id = r.id
      where r.owner_id = auth.uid()
    )
    or public.is_admin_or_manager()
  );

-- ------------------------------------------------------------------------------
-- 5.8 INCIDENTS RLS
-- ------------------------------------------------------------------------------
create policy "Involved parties and managers can view incidents"
  on public.incidents for select
  to authenticated
  using (
    reporter_id = auth.uid()
    or resource_id in (select id from public.resources where owner_id = auth.uid())
    or booking_id in (select id from public.bookings where requester_id = auth.uid())
    or public.is_admin_or_manager()
  );

create policy "Involved borrowers and owners can report incidents"
  on public.incidents for insert
  to authenticated
  with check (
    reporter_id = auth.uid()
    or public.is_admin_or_manager()
  );

create policy "Owners and managers can review and resolve incidents"
  on public.incidents for update
  to authenticated
  using (
    resource_id in (select id from public.resources where owner_id = auth.uid())
    or public.is_admin_or_manager()
  )
  with check (
    resource_id in (select id from public.resources where owner_id = auth.uid())
    or public.is_admin_or_manager()
  );

-- ------------------------------------------------------------------------------
-- 5.8 ACTIVITY EVENTS RLS (Append-Only)
-- ------------------------------------------------------------------------------
create policy "Activity events are readable by authenticated users"
  on public.activity_events for select
  to authenticated
  using (true);

create policy "Authenticated actors and system functions can record events"
  on public.activity_events for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    or actor_id is null
    or public.is_admin_or_manager()
  );

-- Note: No UPDATE or DELETE policies are defined for activity_events,
-- and the trigger trg_protect_activity_events explicitly blocks mutation.

-- ------------------------------------------------------------------------------
-- 5.9 NOTIFICATIONS RLS
-- ------------------------------------------------------------------------------
create policy "Users can view their own notifications"
  on public.notifications for select
  to authenticated
  using (
    recipient_id = auth.uid()
    or public.is_admin_or_manager()
  );

create policy "Users can mark their own notifications as read"
  on public.notifications for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

create policy "Users can delete their own notifications"
  on public.notifications for delete
  to authenticated
  using (recipient_id = auth.uid());

create policy "System and participants can insert notifications"
  on public.notifications for insert
  to authenticated
  with check (true);
