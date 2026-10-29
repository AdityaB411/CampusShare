# CampusShare — Production Deployment & Configuration Guide

> **Document Type**: Production Deployment, Hosting Configuration, and Environment Checklist<br>
> **Target System**: CampusShare — Single-Campus Resource & Equipment Desk<br>
> **Challenge**: *"Unlock Underused Equipment and Spaces"* ([docs/PROBLEM_STATEMENT.txt](PROBLEM_STATEMENT.txt))<br>
> **Related Documents**: [docs/DEMO_SETUP.md](DEMO_SETUP.md) | [docs/JUDGE_TEST_GUIDE.md](JUDGE_TEST_GUIDE.md) | [docs/RELEASE_AUDIT.md](RELEASE_AUDIT.md)

---

## 1. Build Specifications & Architecture

CampusShare's frontend is a Single-Page Application (SPA) built with React 19, TypeScript 5.9, and Vite 8.

| Parameter | Exact Value / Command | Notes |
| :--- | :--- | :--- |
| **Node.js Runtime** | `20.x` or `24.x` (Node 24 LTS verified) | Node.js v24.14.1 verified during audit |
| **Package Manager** | `npm` (v10+) | Standard npm workflow |
| **Working Directory** | `./frontend` | Frontend root folder |
| **Dependencies Install** | `npm install` | Run within `frontend/` directory |
| **Type Check & Build** | `npm run build` | Executes `tsc -b && vite build` |
| **Output Directory** | `dist` (relative to `frontend/`) | Contains `index.html` and bundled assets |
| **Preview Server** | `npm run preview` | Runs Vite preview on port 4173 |

---

## 2. Environment Variables Specification

The frontend requires only public client configuration. **Never** include the Supabase `service_role` key, database passwords, or private connection strings.

### Environment Variable Table

| Variable Name | Required? | Description | Example Value |
| :--- | :---: | :--- | :--- |
| `VITE_SUPABASE_URL` | **Yes** | HTTPS REST URL of your Supabase project | `https://your-project.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | **Yes** | Public anonymous JWT key (safe for browser) | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `VITE_CAMPUS_ID` | Optional | Campus / institution partition key | `main-campus` (defaults to `main-campus`) |

### Local Development Configuration
For local development, create `frontend/.env.local` by copying the template:
```bash
cp .env.example frontend/.env.local
```
Then supply your Supabase project URL and anon key.

> [!WARNING]
> **Strict Secret Isolation**:
> - `VITE_SUPABASE_ANON_KEY` has public RLS restrictions.
> - The Supabase **`service_role`** secret key must **NEVER** be placed in `.env.local` or frontend source code.

---

## 3. Git Secret Exclusion & Safeguards

The repository enforces strict `.gitignore` rules at both the workspace root and within `frontend/`:

```gitignore
# Excluded from version control:
.env
.env.local
.env.*.local
*.local
dist/
node_modules/
```

### Pre-Deployment Git Verification Command
Verify that no sensitive files or environment configurations are tracked:
```bash
git status --ignored
git check-ignore frontend/.env.local
```
Both commands confirm that `.env.local` and local build outputs are untracked and excluded from commits.

---

## 4. Database Setup & Migration Sequence

Deploy the PostgreSQL schema to your Supabase project before deploying the frontend.

### 4.1 Database Prerequisites & Platform Dependencies
- **PostgreSQL Version**: PostgreSQL 15+ (standard on all active Supabase projects).
- **Required Extensions**:
  - `uuid-ossp` (UUID generation functions, e.g. `uuid_generate_v4()`)
  - `pgcrypto` (cryptographic hashing and `gen_random_uuid()`)
  *Both extensions are created automatically by `001_core_schema.sql`.*
- **Platform Schema Dependencies**:
  - `auth.users`: Managed by Supabase Auth. The `public.profiles` table references `auth.users(id)` with `on delete cascade`.
  - Trigger `on_auth_user_created` attaches to `auth.users` for automatic profile provisioning.
- **Database Roles & Permissions**:
  - `anon`: Unauthenticated visitors (granted `SELECT` on published resources and physical custody lookup RPC).
  - `authenticated`: Signed-in users (access strictly filtered by Row-Level Security policies).
  - `postgres` / `service_role`: Used exclusively during migration execution in the Supabase Dashboard SQL Editor.
- **Function Security Standards**:
  - All 32 stored procedures and trigger handlers are declared with `SECURITY DEFINER SET search_path = public` to guarantee search-path integrity against schema hijacking.

---

### 4.2 Fresh Project vs. Existing Database Considerations

#### Case A: Fresh Supabase Project (Recommended)
If creating a new Supabase project for CampusShare:
1. The `auth` schema and `auth.users` table are already pre-provisioned by Supabase.
2. The `public` schema is clean.
3. Simply execute migrations `001_core_schema.sql` through `007_notifications_and_reminders.sql` in numerical sequence.

#### Case B: Existing Supabase Project (Cautions & Backfill)
If deploying CampusShare into an existing Supabase project:
1. **Existing Table Collision Warning**: Check whether any of the 10 core tables already exist (`profiles`, `resources`, `bookings`, `project_groups`, `group_members`, `profile_qualifications`, `condition_reports`, `incidents`, `notifications`, `activity_events`). If existing tables share these names with conflicting schemas, create a new separate Supabase project.
2. **Existing Users Backfill**: If `auth.users` already contains user accounts created before applying `001_core_schema.sql`, those existing accounts will not have matching rows in `public.profiles`. Run this safe backfill query immediately after `001_core_schema.sql`:
   ```sql
   -- Backfill existing auth.users into public.profiles
   insert into public.profiles (
     id,
     display_name,
     primary_role,
     campus_affiliation_status,
     owner_verification_status
   )
   select
     id,
     coalesce(raw_user_meta_data->>'display_name', split_part(email, '@', 1), 'Campus User'),
     'borrower',
     'unverified',
     'unverified'
   from auth.users
   on conflict (id) do nothing;
   ```
3. **Immutable Trigger Caution**: `001_core_schema.sql` attaches `trg_protect_activity_events` to `public.activity_events`, which permanently rejects `UPDATE` and `DELETE` commands. Do not insert test data into `activity_events` that you expect to delete manually; use the `BEGIN ... ROLLBACK` pattern instead.

---

### 4.3 Step-by-Step Migration Order & Expected Outcomes

The table below documents the original base migrations (001–007). The repository now contains migrations 001–015. For a fresh project, apply every migration in numerical order exactly once using the repository's migration workflow. For an existing/live project, **do not rerun migrations that are already recorded as applied**; inspect migration history first. Migrations 008–015 are the security, privacy, scheduler, extension-state, indexing, validation, and RLS-helper follow-ups.

| Step | Migration File | Key Objects Created | Expected Outcome |
| :---: | :--- | :--- | :--- |
| **1** | **[`supabase/migrations/001_core_schema.sql`](../supabase/migrations/001_core_schema.sql)** | 10 tables, 2 extensions, 3 triggers (`on_auth_user_created`, `trg_prevent_profile_elevation`, `trg_protect_activity_events`), RLS enabled on all tables, base policies. | Query returns `Success. No rows returned`. 10 tables visible in Table Editor. |
| **2** | **[`supabase/migrations/002_booking_operations.sql`](../supabase/migrations/002_booking_operations.sql)** | `check_borrower_eligibility`, `submit_booking_request` (fair-use limits), `approve_booking_request` (`FOR UPDATE` locking, custody hold), `reject_booking_request`, `waitlist_booking_request`, `cancel_booking`, `request_booking_extension`, `decide_booking_extension`. | Query returns `Success`. 8 booking operations registered in Database -> Functions. |
| **3** | **[`supabase/migrations/003_handoff_return_incidents.sql`](../supabase/migrations/003_handoff_return_incidents.sql)** | `confirm_checkout` (condition checklist & supervision gates), `submit_return` (condition mismatch detection), `confirm_return`, `report_incident`, `resolve_incident`. | Query returns `Success`. 5 handoff and incident RPCs registered. |
| **4** | **[`supabase/migrations/004_auth_and_roles.sql`](../supabase/migrations/004_auth_and_roles.sql)** | `assign_user_role` (admin only), `verify_user_status` (manager/admin), `verify_qualification`, `request_owner_verification`, `request_affiliation_verification`. | Query returns `Success`. 5 authorization RPCs registered. |
| **5** | **[`supabase/migrations/005_resource_catalogue.sql`](../supabase/migrations/005_resource_catalogue.sql)** | Public select policies on `resources`, `archive_resource`, `create_project_group`, `verify_project_group`, `decide_group_membership`. | Query returns `Success`. Catalogue and group management policies active. |
| **6** | **[`supabase/migrations/006_resource_lifecycle.sql`](../supabase/migrations/006_resource_lifecycle.sql)** | `get_active_resource_custody` (public physical custody lookup), `get_booking_timeline` (ordered activity audit query), incident select policies. | Query returns `Success`. Custody and timeline functions available. |
| **7** | **[`supabase/migrations/007_notifications_and_reminders.sql`](../supabase/migrations/007_notifications_and_reminders.sql)** | `generate_due_reminders` (deterministic deduplicated reminders), `mark_all_notifications_as_read`, `get_unread_notifications_count`. | Query returns `Success`. Reminder engine functions registered. |
| **8** | **[`supabase/migrations/008_security_access_reconciliation.sql`](../supabase/migrations/008_security_access_reconciliation.sql)** | Explicit grants, RLS reconciliation, guarded resource updates, checkout and incident checks. | Applied to the connected project. |
| **9** | **[`supabase/migrations/009_profile_custody_and_reminder_scheduler.sql`](../supabase/migrations/009_profile_custody_and_reminder_scheduler.sql)** | Role escalation protection, minimal custody output, 15-minute `pg_cron` reminder job. | Active job verified; one successful run observed. |
| **10** | **[`supabase/migrations/010_profile_privacy_fail_closed.sql`](../supabase/migrations/010_profile_privacy_fail_closed.sql)** | Scoped profile reads and fail-closed verification trigger. | Applied to the connected project. |
| **11** | **[`supabase/migrations/011_embed_extension_state.sql`](../supabase/migrations/011_embed_extension_state.sql)** | Copies extension state to bookings and legacy history to the Trust Record. | Applied before legacy-table removal. |
| **12** | **[`supabase/migrations/012_booking_extension_state.sql`](../supabase/migrations/012_booking_extension_state.sql)** | Booking-based extension RPCs and removal of `extension_requests`. | Legacy table absent after migration. |
| **13** | **[`supabase/migrations/013_fk_indexes_and_policy_performance.sql`](../supabase/migrations/013_fk_indexes_and_policy_performance.sql)** | Foreign-key indexes and optimized RLS predicates. | Applied to the connected project. |
| **14** | **[`supabase/migrations/014_validation_edge_cases.sql`](../supabase/migrations/014_validation_edge_cases.sql)** | Enforces max total booking duration for extensions and null-safe resource validation. | Applied to the connected project. |
| **15** | **[`supabase/migrations/015_rls_identity_helpers.sql`](../supabase/migrations/015_rls_identity_helpers.sql)** | Makes role-check helpers safe for use inside profiles RLS without recursive policy evaluation. | Applied to the connected project. |

---

### 4.4 Post-Migration Verification Queries

Run the following safe read-only queries in the **Supabase SQL Editor** immediately after completing migrations 001–014 on a fresh project to verify database integrity:

```sql
-- ==============================================================================
-- CampusShare Post-Migration Health & Integrity Check
-- Execute in Supabase SQL Editor. Expected: 10 tables with RLS, 3 triggers, 0 errors.
-- ==============================================================================

-- 1. Verify all 10 core tables exist and have Row-Level Security (RLS) enabled
select
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
order by tablename;
-- Expected: 10 rows: activity_events, bookings, condition_reports, group_members,
-- incidents, notifications, profile_qualifications, profiles, project_groups, resources.
-- All must show rls_enabled = true.

-- 2. Verify all 3 critical security triggers are active
select
  event_object_schema,
  event_object_table,
  trigger_name
from information_schema.triggers
where trigger_schema in ('public', 'auth')
  and trigger_name in ('on_auth_user_created', 'trg_prevent_profile_elevation', 'trg_protect_activity_events')
order by event_object_table;
-- Expected: 3 rows (auth.users, public.profiles, public.activity_events).

-- 3. Verify function registration count in public schema
select count(*) as public_function_count
from pg_proc p
join pg_namespace n on p.pronamespace = n.oid
where n.nspname = 'public';
-- Expected: >= 32 functions registered.

-- 4. Test dry-run invocation of physical custody lookup (accessible to anon)
select * from public.get_active_resource_custody();
-- Expected: 0 rows returned, 0 errors (clean empty table).
```

---

### 4.5 Rollback & Disaster Recovery Procedures

If a migration fails partway through or if you need to cleanly reset the database schema on a test project, execute the following teardown script in the **Supabase SQL Editor**:

> [!CAUTION]
> **Data Destruction Warning**: This script drops all CampusShare tables and functions in the `public` schema. It does NOT touch `auth.users` or Supabase project settings. Run only when intentionally resetting the database.

```sql
-- ==============================================================================
-- CampusShare Emergency Rollback / Schema Teardown Script
-- Drops all CampusShare application objects in reverse-dependency order.
-- ==============================================================================

-- 1. Remove triggers
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists trg_prevent_profile_elevation on public.profiles;
drop trigger if exists trg_protect_activity_events on public.activity_events;

-- 2. Drop all application tables in dependency order
drop table if exists public.notifications cascade;
drop table if exists public.activity_events cascade;
drop table if exists public.incidents cascade;
drop table if exists public.condition_reports cascade;
drop table if exists public.bookings cascade;
drop table if exists public.profile_qualifications cascade;
drop table if exists public.group_members cascade;
drop table if exists public.project_groups cascade;
drop table if exists public.resources cascade;
drop table if exists public.profiles cascade;

-- 3. Drop application RPC functions
drop function if exists public.handle_new_user() cascade;
drop function if exists public.check_profile_elevation() cascade;
drop function if exists public.prevent_audit_tampering() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.is_admin_or_manager() cascade;
drop function if exists public.is_verified_owner() cascade;
drop function if exists public.is_resource_owner(uuid) cascade;
drop function if exists public.check_borrower_eligibility(uuid, uuid) cascade;
drop function if exists public.submit_booking_request(uuid, timestamptz, timestamptz, text, uuid, uuid) cascade;
drop function if exists public.approve_booking_request(uuid, text) cascade;
drop function if exists public.reject_booking_request(uuid, text) cascade;
drop function if exists public.waitlist_booking_request(uuid, text) cascade;
drop function if exists public.cancel_booking(uuid, text) cascade;
drop function if exists public.request_booking_extension(uuid, timestamptz, text) cascade;
drop function if exists public.decide_booking_extension(uuid, boolean, text) cascade;
drop function if exists public.confirm_checkout(uuid, text, jsonb, text, boolean) cascade;
drop function if exists public.submit_return(uuid, text, jsonb, text) cascade;
drop function if exists public.confirm_return(uuid, text) cascade;
drop function if exists public.report_incident(uuid, text, text, text) cascade;
drop function if exists public.resolve_incident(uuid, text, text) cascade;
drop function if exists public.assign_user_role(uuid, text) cascade;
drop function if exists public.verify_user_status(uuid, text) cascade;
drop function if exists public.verify_qualification(uuid, text, timestamptz) cascade;
drop function if exists public.request_owner_verification() cascade;
drop function if exists public.request_affiliation_verification() cascade;
drop function if exists public.archive_resource(uuid, text) cascade;
drop function if exists public.create_project_group(text, text) cascade;
drop function if exists public.verify_project_group(uuid, boolean) cascade;
drop function if exists public.decide_group_membership(uuid, uuid, text) cascade;
drop function if exists public.get_active_resource_custody() cascade;
drop function if exists public.get_booking_timeline(uuid) cascade;
drop function if exists public.generate_due_reminders() cascade;
drop function if exists public.mark_all_notifications_as_read() cascade;
drop function if exists public.get_unread_notifications_count() cascade;
```

---

### 4.6 Post-Migration Smoke Test Checklist

Before deploying or connecting the frontend, verify each of the following database gates:

- [ ] **Gate 1: Schema Integrity**<br>
  All 10 tables exist in `public` with `rowsecurity = true`.
- [ ] **Gate 2: Auto-Provisioning Hook**<br>
  Trigger `on_auth_user_created` exists on `auth.users`. Creating a test user creates a matching `borrower` row in `public.profiles`.
- [ ] **Gate 3: Self-Elevation Block**<br>
  Direct client `UPDATE` on `public.profiles.primary_role` is rejected by `trg_prevent_profile_elevation`.
- [ ] **Gate 4: Append-Only Trust Record**<br>
  Direct `UPDATE` or `DELETE` on `public.activity_events` is rejected by `trg_protect_activity_events`.
- [ ] **Gate 5: Search Path Lockdown**<br>
  All 32 stored procedures declare `SET search_path = public`.
- [ ] **Gate 6: Demo Data Seed**<br>
  The 5 demo accounts and 3 test resources are provisioned per [docs/DEMO_SETUP.md](DEMO_SETUP.md).

---

---

## 5. Hosting Provider Configuration & SPA Routing Fallback

CampusShare can be deployed on any modern static web hosting provider (e.g. Vercel, Netlify, Cloudflare Pages, Render).

### 5.1 Pre-Configured Client-Side Routing Fallbacks
Because CampusShare is a Single-Page Application (SPA) using React Router v7 with browser history navigation, direct URL navigation or browser refreshing on routes like `/resources`, `/signin`, `/my-bookings`, `/owner-queue`, or `/admin` requires the hosting web server to rewrite all requests to `/index.html`.

The repository includes pre-configured routing fallbacks for all major hosting providers:
1. **Vercel**: Pre-configured in [`frontend/vercel.json`](../frontend/vercel.json):
   ```json
   {
     "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
   }
   ```
2. **Netlify & Cloudflare Pages**: Pre-configured in [`frontend/public/_redirects`](../frontend/public/_redirects):
   ```
   /*    /index.html   200
   ```
   *Vite automatically copies `_redirects` into the build output root (`dist/`) during `npm run build`.*

---

### 5.2 Hosting Provider Deployment Procedures

#### Option A: Vercel (Recommended)
1. Import your CampusShare Git repository in the **Vercel Dashboard**.
2. Configure project build settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build` (runs `tsc -b && vite build`)
   - **Output Directory**: `dist`
3. In **Project Settings** -> **Environment Variables**, configure the 3 public variables:
   - `VITE_SUPABASE_URL` = `https://<your-project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `<your-public-anon-key>`
   - `VITE_CAMPUS_ID` = `main-campus`
4. Click **Deploy**. Vercel will build the frontend and serve it with global edge CDN distribution.

#### Option B: Netlify
1. Connect your Git repository in the **Netlify Dashboard**.
2. Set build settings:
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `frontend/dist`
3. In **Site Configuration** -> **Environment variables**, add the 3 variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_CAMPUS_ID`).
4. Click **Deploy site**.

#### Option C: Cloudflare Pages
1. In Cloudflare Dashboard -> **Workers & Pages**, create a new application connected to Git.
2. Select `Vite` preset with root directory `frontend`, build command `npm run build`, output directory `dist`.
3. Add the 3 environment variables in Settings.
4. Deploy site.

---

### 5.3 Pre-Deployment Verification Checklist (All 9 Gates)

Before opening the deployed URL to live users or hackathon evaluators, verify each gate:

- [x] **Gate 1: Production Build Success**: Verified `npm run build` completes in ~1.06s with 0 TypeScript errors.
- [x] **Gate 2: Environment Variables**: Standardized on `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_CAMPUS_ID` (names only; values never committed).
- [x] **Gate 3: Secret Isolation**: Ripgrep scan confirmed 0 passwords, secrets, or `service_role` keys in `frontend/dist/`.
- [x] **Gate 4: Auth Redirect URLs**: Documented in Section 6 (Site URL and wildcard patterns `/**`).
- [x] **Gate 5: Client-Side Routing Fallback**: `frontend/vercel.json` and `frontend/public/_redirects` verified present and built into `dist/`.
- [x] **Gate 6: Auth Cycle & Error Handling**: Verified in `AuthContext.tsx`, `SignInPage.tsx`, and `ProtectedRoute.tsx`.
- [x] **Gate 7: Public RLS & Role Defense**: All 10 tables enforced by PostgreSQL RLS; self-elevation blocked by `trg_prevent_profile_elevation`.
- [x] **Gate 8: No Debug Bypasses**: Persona quick-fill buttons only populate emails; passwords must be entered manually; zero mock shortcuts in production build.
- [x] **Gate 9: Responsiveness & Accessibility**: Tested on 375px mobile viewports with collapsible hamburger drawer, visible focus outlines, and friendly error alerts.

---

---

## 6. Supabase Authentication Redirect URLs

To ensure users can sign in, sign out, and receive auth confirmations without redirection errors:

1. Open **Supabase Dashboard** -> **Authentication** -> **URL Configuration**.
2. **Site URL**: Enter your deployed domain:
   ```
   https://your-campusshare-deployment.vercel.app
   ```
3. **Redirect URLs**: Add the following patterns:
   ```
   https://your-campusshare-deployment.vercel.app/**
   http://localhost:5173/**
   http://localhost:4173/**
   ```
4. Click **Save Changes**.

---

## 7. Post-Deployment Verification (Fresh / Incognito Browser)

Follow this 6-step checklist immediately after deploying to verify operational readiness:

- [ ] **Step 1: Fresh Incognito Window**<br>
  Open a new private/incognito browser window and navigate to the deployed URL. Verify the title displays `CampusShare — Campus Resource & Equipment Desk`.
- [ ] **Step 2: Unauthenticated Catalogue Browsing**<br>
  Click on **Resources** (`/resources`). Verify published equipment and spaces load without requiring login.
- [ ] **Step 3: Sign In with Demo Account**<br>
  Navigate to `/signin`. Sign in using `aarav.sharma@campus.edu`. Verify successful authentication and redirection to the authenticated view.
- [ ] **Step 4: Check Protected Route Security**<br>
  While signed in as Borrower Aarav, attempt to open `/owner-queue` or `/admin`. Verify the application denies access or redirects appropriately.
- [ ] **Step 5: Inspect Browser Console**<br>
  Open Developer Tools (`F12`) -> **Console**. Confirm there are zero uncaught runtime errors, missing asset 404s, or mixed content warnings.
- [ ] **Step 6: Sign Out**<br>
  Click **Sign Out**. Verify session tokens are cleared and the navigation bar returns to the unauthenticated state.
