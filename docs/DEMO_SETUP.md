# CampusShare — Demo Setup & Fictional Seed Guide

> **Document Type**: Manual Demo Setup, Role Authorization, and Fictional Seed Guide<br>
> **Target System**: CampusShare — Single-Campus Resource & Equipment Desk<br>
> **Challenge**: *"Unlock Underused Equipment and Spaces"* ([docs/PROBLEM_STATEMENT.txt](PROBLEM_STATEMENT.txt))<br>
> **Related Documents**: [docs/DEPLOYMENT.md](DEPLOYMENT.md) | [docs/JUDGE_TEST_GUIDE.md](JUDGE_TEST_GUIDE.md) | [docs/RELEASE_AUDIT.md](RELEASE_AUDIT.md)

---

## 1. Overview & Guiding Security Principles

This guide details how an evaluator, administrator, or presenter can manually establish a clean, segregated demonstration environment with distinct role personas.

### Core Security Rules for Demo Environments:
1. **No Automated Creation or Hardcoded Passwords**: Demo accounts are never created automatically by runtime scripts. Passwords are set manually by the operator during setup.
2. **No Public Role-Switching Buttons**: There is no client-side "toggle role" dropdown in the production interface. Roles and permissions are strictly enforced on the server by PostgreSQL Row-Level Security (RLS).
3. **No Secret Key Leakage**: Seed scripts use standard PostgreSQL `auth.uid()` or SQL editor execution. The Supabase `service_role` key is **never** embedded in frontend source files or Git repositories.

---

## 2. Fictional Persona Specifications & Permission Boundaries

For an authentic demonstration of institutional workflows, create the following 5 distinct user accounts:

| Persona | Fictional Email | Role | Affiliation Status | Owner Status | Key Permissions & Constraints |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Verified Borrower** | `aarav.sharma@campus.edu` | `borrower` | `verified` | `unverified` | **Can**: Discover resources, request bookings, confirm check-out, submit returns, report incidents on own bookings, view own notifications.<br>**Blocked**: Cannot approve bookings, manage resources, verify users, or access admin logs. |
| **Unverified Borrower** | `rohan.verma@campus.edu` | `borrower` | `unverified` | `unverified` | **Can**: Discover published resources.<br>**Blocked**: Requests routed to `pending_verification`; blocked from reserving restricted resources; cannot check out or access privileged queues. |
| **Resource Custodian / Owner** | `prof.raman@campus.edu` | `owner` | `verified` | `verified` | **Can**: List/edit/archive owned resources, approve/reject/waitlist booking requests on owned resources, confirm hand-back return, view incidents on owned assets.<br>**Blocked**: Cannot modify resources owned by others, assign system roles, or modify global quotas. |
| **Facilities Coordinator / Manager** | `coordinator@campus.edu` | `manager` | `verified` | `unverified` | **Can**: Verify borrower affiliations and safety qualifications (`TRN-*`), audit project groups, review and resolve incidents campus-wide, view full booking history.<br>**Blocked**: Cannot reassign system administrator roles (`assign_user_role` requires `admin`). |
| **System Administrator** | `admin@campus.edu` | `admin` | `verified` | `unverified` | **Can**: Assign all system roles via `assign_user_role`, inspect the immutable `activity_events` trust record, adjust fair-use quotas, perform all manager operations.<br>**Blocked**: Cannot tamper with append-only activity logs (enforced by database trigger). |

---

### 2.1 Server-Side Role Elevation Protections
CampusShare guarantees that privileged roles (`owner`, `manager`, `admin`) and verification statuses **cannot** be acquired through client-side manipulation:

1. **Auto-Provisioning Default**: The database trigger `on_auth_user_created` (executing `public.handle_new_user()`) strictly hardcodes new accounts as `primary_role = 'borrower'`, `campus_affiliation_status = 'unverified'`, and `owner_verification_status = 'unverified'`. Role metadata supplied during sign-up is ignored.
2. **Elevation Defense Trigger**: The PostgreSQL trigger `trg_prevent_profile_elevation` monitors `BEFORE UPDATE` operations on `public.profiles`. If an ordinary user attempts to change `primary_role`, `campus_affiliation_status`, or `owner_verification_status`, the transaction raises an immediate exception (`'Security violation: Users cannot elevate their own role or verification status.'`).
3. **RPC Authorization Gates**: Stored procedures like `assign_user_role()` and `verify_user_status()` strictly verify that `auth.uid()` corresponds to an active `admin` or `manager` before applying modifications.
4. **Client Quick-Fill Isolation**: The persona buttons in `frontend/src/pages/SignInPage.tsx` only populate the email field in the browser form and clear the password input. They perform no automated sign-in, token forging, or role switching.

---

## 3. Account Creation Procedures

You can create these accounts using either of the following safe methods:

### Method A: Via Supabase Dashboard (Recommended for Fast Setup)
1. Open your Supabase Project Dashboard -> **Authentication** -> **Users**.
2. Click **"Add user"** -> **"Create user"**.
3. Enter the email address (e.g. `prof.raman@campus.edu`) and a secure temporary password.
4. Set **Auto Confirm User?** to **ON** (so email verification is not required for demo accounts).
5. Click **Create User**.
6. Repeat for all 5 fictional accounts.

### Method B: Via CampusShare Web Sign-Up (`/signup`)
1. Navigate to `http://localhost:5173/signup` (or your deployed URL).
2. Enter the user's display name, email, and password.
3. Click **"Create Account"**.
4. The database trigger `handle_new_user()` will automatically initialize the profile in `public.profiles` as a `borrower` with `unverified` affiliation.

---

## 4. Safe Role Granting & Verification (SQL Procedure)

In CampusShare, users cannot self-assign roles or verify their own credentials due to the `trg_prevent_profile_elevation` trigger. To promote the created accounts to their designated demonstration roles, run the following SQL script directly in the **Supabase SQL Editor**:

```sql
-- ==============================================================================
-- CampusShare Manual Demo Role & Verification Elevation Script
-- Run this in the Supabase Dashboard SQL Editor after creating auth accounts.
-- ==============================================================================

-- 1. Elevate Prof. Raman to Verified Resource Owner
update public.profiles
set primary_role = 'owner',
    campus_affiliation_status = 'verified',
    owner_verification_status = 'verified',
    display_name = 'Prof. Raman (Media & Fab Custodian)',
    updated_at = now()
where id in (select id from auth.users where email = 'prof.raman@campus.edu');

-- 2. Elevate Campus Coordinator to Facilities Manager
update public.profiles
set primary_role = 'manager',
    campus_affiliation_status = 'verified',
    display_name = 'Campus Operations Coordinator',
    updated_at = now()
where id in (select id from auth.users where email = 'coordinator@campus.edu');

-- 3. Elevate System Administrator
update public.profiles
set primary_role = 'admin',
    campus_affiliation_status = 'verified',
    display_name = 'Institutional Administrator',
    updated_at = now()
where id in (select id from auth.users where email = 'admin@campus.edu');

-- 4. Verify Borrower Aarav Sharma
update public.profiles
set primary_role = 'borrower',
    campus_affiliation_status = 'verified',
    display_name = 'Aarav Sharma (Verified Student)',
    updated_at = now()
where id in (select id from auth.users where email = 'aarav.sharma@campus.edu');

-- 5. Ensure Unverified Borrower Rohan Verma remains unverified
update public.profiles
set primary_role = 'borrower',
    campus_affiliation_status = 'unverified',
    owner_verification_status = 'unverified',
    display_name = 'Rohan Verma (New Student)',
    updated_at = now()
where id in (select id from auth.users where email = 'rohan.verma@campus.edu');

-- 6. Grant Prerequisite Safety Training Qualifications to Aarav Sharma (TRN-MED-01 & TRN-FAB-01)
insert into public.profile_qualifications (
  user_id,
  training_code,
  status,
  expires_at,
  verified_at
)
select
  u.id as user_id,
  q.training_code,
  'verified' as status,
  now() + interval '180 days' as expires_at,
  now() as verified_at
from auth.users u
cross join (values ('TRN-MED-01'), ('TRN-FAB-01')) as q(training_code)
where u.email = 'aarav.sharma@campus.edu'
on conflict (user_id, training_code) do update set
  status = 'verified',
  expires_at = now() + interval '180 days';
```

---

## 5. Fictional Resource Seed Data

Execute the following script in the **Supabase SQL Editor** to populate 3 diverse campus resources: a standard piece of equipment, a training-restricted fabrication tool, and a supervised research space. This script is fully idempotent and safe to re-run.

```sql
-- ==============================================================================
-- CampusShare Fictional Demonstration Resources & Project Groups Seed
-- Execute after running the Role Elevation script above.
-- Idempotent: safe to run multiple times without duplicate errors.
-- ==============================================================================

do $$
declare
  v_owner_id uuid;
  v_manager_id uuid;
  v_borrower_id uuid;
  v_res_media uuid;
  v_res_printer uuid;
  v_res_robotics uuid;
  v_group_id uuid;
begin
  -- Resolve Owner, Manager, and Borrower IDs
  select id into v_owner_id from auth.users where email = 'prof.raman@campus.edu';
  select id into v_manager_id from auth.users where email = 'coordinator@campus.edu';
  select id into v_borrower_id from auth.users where email = 'aarav.sharma@campus.edu';

  if v_owner_id is null then
    raise exception 'Account prof.raman@campus.edu not found. Please create it first.';
  end if;

  -- ----------------------------------------------------------------------------
  -- RESOURCE 1: Standard Equipment (Open to all verified campus borrowers)
  -- ----------------------------------------------------------------------------
  if not exists (select 1 from public.resources where title = 'Sony Cinema FX3 4K Kit' and owner_id = v_owner_id) then
    insert into public.resources (
      owner_id,
      type,
      category,
      title,
      summary,
      location_label,
      state,
      max_duration_hours,
      rules,
      required_training_code,
      requires_supervision
    ) values (
      v_owner_id,
      'equipment',
      'Media & Production',
      'Sony Cinema FX3 4K Kit',
      'Full-frame cinema line camera with 24-70mm GM lens, 2x 160GB CFexpress cards, cage, and shotgun microphone.',
      'Media Lab C-204 (Equipment Desk)',
      'published',
      4,
      'Return with clean sensor and dry bag. Batteries must be recharged to at least 50% prior to return.',
      null, -- No specific training code required; campus affiliation is sufficient
      false
    ) returning id into v_res_media;
  else
    select id into v_res_media from public.resources where title = 'Sony Cinema FX3 4K Kit' and owner_id = v_owner_id;
  end if;

  -- ----------------------------------------------------------------------------
  -- RESOURCE 2: Training-Restricted Equipment (Requires TRN-FAB-01 Induction)
  -- ----------------------------------------------------------------------------
  if not exists (select 1 from public.resources where title = 'Formlabs Form 3+ SLA 3D Printer' and owner_id = v_owner_id) then
    insert into public.resources (
      owner_id,
      type,
      category,
      title,
      summary,
      location_label,
      state,
      max_duration_hours,
      rules,
      required_training_code,
      requires_supervision
    ) values (
      v_owner_id,
      'equipment',
      'Rapid Prototyping',
      'Formlabs Form 3+ SLA 3D Printer',
      'High-resolution stereolithography (SLA) resin printer with automated wash and cure stations.',
      'Innovation Makerspace Bay M-12',
      'published',
      6,
      'Mandatory nitrile gloves during handling. Only standard grey and clear photopolymer resins permitted.',
      'TRN-FAB-01', -- Prerequisite Safety Induction
      false
    ) returning id into v_res_printer;
  else
    select id into v_res_printer from public.resources where title = 'Formlabs Form 3+ SLA 3D Printer' and owner_id = v_owner_id;
  end if;

  -- ----------------------------------------------------------------------------
  -- RESOURCE 3: Supervised Space (Requires Staff Supervisor Presence)
  -- ----------------------------------------------------------------------------
  if not exists (select 1 from public.resources where title = 'Autonomous Robotics & Drone Flight Bay' and owner_id = v_owner_id) then
    insert into public.resources (
      owner_id,
      type,
      category,
      title,
      summary,
      location_label,
      state,
      max_duration_hours,
      rules,
      required_training_code,
      requires_supervision
    ) values (
      v_owner_id,
      'space',
      'Specialized Lab Space',
      'Autonomous Robotics & Drone Flight Bay',
      'Net-enclosed flight cell with optical motion-tracking cameras, ESD-safe assembly benches, and spectrum analyzer.',
      'Robotics Research Annex E-108',
      'published',
      3,
      'Safety goggles mandatory. Live propeller testing prohibited outside netted volume. Supervisor must be on site.',
      'TRN-ROB-01', -- Advanced Robotics Training
      true          -- REQUIRES AUTHORIZED SUPERVISOR CONFIRMATION
    ) returning id into v_res_robotics;
  else
    select id into v_res_robotics from public.resources where title = 'Autonomous Robotics & Drone Flight Bay' and owner_id = v_owner_id;
  end if;

  -- ----------------------------------------------------------------------------
  -- PROJECT GROUP: Fictional Capstone Team (Idempotent upsert)
  -- ----------------------------------------------------------------------------
  insert into public.project_groups (
    name,
    is_verified,
    reviewer_id
  ) values (
    'Autonomous Aerial Mapping Capstone',
    true,
    v_manager_id
  )
  on conflict (name) do update set is_verified = true
  returning id into v_group_id;

  -- Add Aarav Sharma as approved group member
  if v_borrower_id is not null then
    insert into public.group_members (
      group_id,
      user_id,
      status,
      approved_by
    ) values (
      v_group_id,
      v_borrower_id,
      'approved',
      v_manager_id
    ) on conflict (group_id, user_id) do update set status = 'approved';
  end if;

  raise notice 'CampusShare demonstration seed data populated successfully!';
end $$;
```

---

### 5.1 Post-Seed Verification Queries

Run the following read-only queries in the **Supabase SQL Editor** immediately after running the seed script to verify setup accuracy:

```sql
-- 1. Verify 5 demo accounts, assigned roles, and verification flags
select
  u.email,
  p.display_name,
  p.primary_role,
  p.campus_affiliation_status,
  p.owner_verification_status
from auth.users u
join public.profiles p on u.id = p.id
where u.email in (
  'aarav.sharma@campus.edu',
  'rohan.verma@campus.edu',
  'prof.raman@campus.edu',
  'coordinator@campus.edu',
  'admin@campus.edu'
)
order by u.email;
-- Expected: 5 rows with exact roles: borrower, borrower, owner, manager, admin.

-- 2. Verify Aarav Sharma's safety training inductions
select
  u.email,
  q.training_code,
  q.status,
  q.expires_at > now() as is_active
from public.profile_qualifications q
join auth.users u on q.user_id = u.id
where u.email = 'aarav.sharma@campus.edu';
-- Expected: 2 rows (TRN-MED-01 and TRN-FAB-01, status='verified', is_active=true).

-- 3. Verify 3 demonstration resources
select
  title,
  category,
  type,
  state,
  max_duration_hours,
  required_training_code,
  requires_supervision
from public.resources
order by title;
-- Expected: 3 rows (Autonomous Robotics Bay [supervision=true], Formlabs Form 3+ [TRN-FAB-01], Sony FX3 Kit).

-- 4. Verify capstone project group and approved membership
select
  g.name,
  g.is_verified,
  count(m.user_id) as approved_members
from public.project_groups g
left join public.group_members m on g.id = m.group_id and m.status = 'approved'
group by g.id, g.name, g.is_verified;
-- Expected: 1 row ('Autonomous Aerial Mapping Capstone', is_verified=true, approved_members=1).
```

---

## 6. Demonstration Scenario Instructions

### Scenario A: Testing the Eligibility Blocker
1. Sign in as **Unverified Borrower** (`rohan.verma@campus.edu`).
2. Go to **Resources** (`/resources`). Open the **Formlabs Form 3+** printer.
3. Observe the red badge: *"Missing prerequisite: TRN-FAB-01"* and *"Unverified campus affiliation"*.
4. Submit a booking request. Notice the request transitions to `pending_verification` without blocking calendar slots.

### Scenario B: Testing Conflict Protection & Concurrency Lock
1. Sign in as **Verified Borrower** (`aarav.sharma@campus.edu`).
2. Request **Sony Cinema FX3 4K Kit** for tomorrow, `10:00 AM – 01:00 PM`.
3. Sign in as **Owner** (`prof.raman@campus.edu`) and **Approve** the booking.
4. Sign out, sign in as another user, and attempt to reserve the same kit for tomorrow `11:00 AM – 02:00 PM`.
5. When the owner reviews the second request, observe that approval is blocked with: *"Scheduling conflict: Time slot overlaps with an approved booking"*.

### Scenario C: Testing the Active Custody Blocker
1. Have Borrower Aarav Sharma start check-out on an approved booking (Status transitions to `in_use`).
2. While the item is `in_use`, have another borrower submit a request for the same item for next week.
3. As the Owner, attempt to approve next week's request.
4. Observe the **Active Custody Blocker**: The database prevents approval while the physical asset has not confirmed hand-back.

### Scenario D: Testing Check-Out, Return, and Human Incident Handling
1. Borrower completes **Check-Out** with checklist (`Good` condition).
2. Borrower completes **Return Submission**, marking condition as `Damaged` with note: *"Filter chipped"*.
3. Notice that status transitions to `return_pending` and an incident is automatically logged for human review.
4. Sign in as **Owner** or **Manager** (`coordinator@campus.edu`).
5. Confirm return hand-back in **Owner Queue**.
6. Navigate to **Admin** (`/admin`) -> **Incident Oversight** and resolve the incident with a documented explanation note. Observe the append-only record in `/activity`.

---

## 7. Password and Secret Safety Verification

- [x] Fictional email addresses (`@campus.edu`) are used exclusively.
- [x] No plaintext passwords or database credentials are committed to version control.
- [x] Service-role secret keys are not used or referenced in the frontend application.
