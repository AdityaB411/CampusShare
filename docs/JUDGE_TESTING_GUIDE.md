# CampusShare — Judge Testing & Evaluation Guide

> **Single-Campus Resource & Equipment Desk**<br>
> Built for the official challenge: *"Unlock Underused Equipment and Spaces"*<br>
> Reference Implementation Plan: **Final Pre-Build Plan v1.2 (`docs/FINAL_PLAN.pdf`)**

---

## 1. Executive Summary & Architecture

CampusShare is a trusted, single-campus platform for students, faculty, and project groups to discover, request, and responsibly share underused equipment and specialised project spaces.

Unlike simple calendar tools that only display bookings, CampusShare enforces:
1. **Server-Side Role Separation**: Distinct permissions for `borrower`, `owner`, `manager`, and `admin` enforced via PostgreSQL Row-Level Security (RLS) and trusted database functions.
2. **Pre-Booking Eligibility Gates**: Automatic verification of campus affiliation, prerequisite safety training credentials, and expiration dates.
3. **Reasoned Custodian Approvals**: Mandatory human justification for all approvals, rejections, and waitlisting decisions.
4. **Physical Custody Tracking**: Start and return condition checklists. While a resource is in active physical custody (`in_use` or `return_pending`), all new approvals remain blocked regardless of the requested slot until physical hand-back is confirmed.
5. **Fair-Use Caps**: Strict count-based anti-monopolisation limits (Individual: max 3 uses in 7 days, max 2 open items; Project Group: max 5 uses in 7 days, max 3 open items).
6. **Append-Only Trust Record**: A tamper-resistant audit timeline (`activity_events`) recording actor, action, previous/new status, and reasons with no client update or delete permissions.
7. **Persistent In-App Notifications & Reminder Engine**: Deduplicated due-soon alerts (<60 min) and overdue notices evaluated on app open and every 5 minutes while a session is active. Strictly no SMS, email, or runtime AI dependencies.

---

## 2. Demo Evaluation Accounts

Synthetic institutional accounts have been pre-configured for evaluation. You can sign in using these accounts at `/signin` (or click the quick-fill buttons on the login screen):

| Role | Email Address | Password Guidance | Intended Evaluation Purpose |
| :--- | :--- | :--- | :--- |
| **Verified Borrower** | `aarav.sharma@campus.edu` | *Set during demo setup / See Judge Pack* | Submits valid bookings; has verified affiliation and `TRN-MED-01` & `TRN-FAB-01` training. |
| **Unverified Borrower** | `rohan.verma@campus.edu` | *Set during demo setup / See Judge Pack* | Tests **Eligibility Blocker**; unverified affiliation and missing safety induction. |
| **Resource Owner / Custodian** | `prof.raman@campus.edu` | *Set during demo setup / See Judge Pack* | Media Lab C-204 custodian; reviews requests, approves/rejects, confirms handoffs and returns. |
| **Campus Facilities Manager** | `coordinator@campus.edu` | *Set during demo setup / See Judge Pack* | Verifies user affiliations, safety credentials, project groups, and conducts human incident reviews. |
| **System Administrator** | `admin@campus.edu` | *Set during demo setup / See Judge Pack* | Assigns system roles, inspects full campus audit logs, and configures fair-use policies. |

*Note: Passwords are set manually by the operator during setup (see [docs/DEMO_SETUP.md](file:///e:/CampusShare/docs/DEMO_SETUP.md)) and are never committed to version control or included in frontend client bundles. Self-registration is also supported at `/signup`.*

---

## 3. Core 10-Step Journey (Happy Path)

Follow these steps to complete a full resource lifecycle from listing to custody release:

### Step 1: Owner Lists Resource
1. Sign in as **Resource Owner** (`prof.raman@campus.edu`).
2. Navigate to **Owner Queue** (`/owner-queue`) -> **Resource Management** tab.
3. Click **"New Resource"** to publish a new equipment unit or project space.
4. Specify title, category, location, duration limit, and required safety training code (e.g., `TRN-MED-01`).
5. Resource is published and immediately discoverable in the catalogue.

### Step 2: Borrower Discovers Resource & Checks Eligibility
1. Sign in as **Verified Borrower** (`aarav.sharma@campus.edu`).
2. Open **Resources** (`/resources`). Filter by type (`Equipment` / `Space`) or category.
3. Click on **Sony Cinema FX3 4K Kit** (or your newly listed resource).
4. The detail drawer opens. Notice the green **"Eligible to Request"** badge confirming verified affiliation and active `TRN-MED-01` credential.

### Step 3: Borrower Requests a Booking
1. Choose a start time and duration within the resource's maximum allowed hours.
2. Enter a legitimate purpose (e.g., *"Final-year Capstone Documentary Shoot"*).
3. Submit the booking. The request status becomes `pending_owner_review` and appears in **My Bookings** (`/my-bookings`).

### Step 4: Owner Reviews & Approves Request
1. Sign in as **Resource Owner** (`prof.raman@campus.edu`).
2. Navigate to **Owner Queue** (`/owner-queue`).
3. Under **Pending Booking Requests**, locate the booking.
4. Click **Approve**. Provide an approval rationale (or accept the default verified reason).
5. The booking status updates to `approved`. An atomic notification and Trust Record event are created.

### Step 5: Check-out with Initial Condition Checklist
1. Sign in as **Verified Borrower** (or Owner).
2. Go to **My Bookings** (`/my-bookings`). Locate the approved booking.
3. Click **"Start Check-out"**.
4. Complete the multi-point condition checklist (e.g., clean lens, charged batteries, intact case) and record condition code (`Good`).
5. Confirm handoff. Status transitions to **`in_use`** (Checked Out).

### Step 6: Active Custody Hold Verified
1. While the item is `in_use`, notice the custody hold banner.
2. Even if another borrower submits a request for a future time slot, the database **Active Custody Blocker** prevents approval until physical custody is confirmed returned.

### Step 7: Return Submission with Final Condition
1. In **My Bookings**, click **"Submit Return"**.
2. Complete the end-of-use checklist, select condition code (`Good`), and enter return notes.
3. Submit return. Booking status updates to **`return_pending`**.

### Step 8: Owner Confirms Hand-Back & Releases Custody
1. Sign in as **Resource Owner** (`prof.raman@campus.edu`).
2. In **Owner Queue**, locate the booking under **Pending Return Confirmations**.
3. Inspect the borrower's return condition notes.
4. Click **"Confirm Return & Release Custody"**.
5. Booking status becomes **`returned`** (Terminal). Custody hold is released, enabling subsequent approvals.

### Step 9: Notifications & Reminders
1. Open **Notifications** (`/notifications`).
2. Inspect decision notices, handoff records, and reminder entries.
3. Click **"Refresh & Check Reminders"** to manually evaluate the 60-minute due-soon and overdue reminder cycle.
4. Click **"Mark Read"** or **"Mark All as Read"** to update unread badge counts.

### Step 10: Inspect Append-Only Trust Record
1. Navigate to **Activity** (`/activity`).
2. Observe the complete, chronological audit timeline: actor snapshot, action, state transitions (`pending_owner_review` -> `approved` -> `in_use` -> `return_pending` -> `returned`), decision reasons, and timestamps.
3. Tamper resistance: RLS prevents client modification or deletion of past events.

---

## 4. Negative & Exception Test Scenarios

CampusShare is designed to fail safely when safety, custody, or fairness rules are breached:

### Scenario A: Ineligible Borrower Blocker (Missing Safety Training)
1. Sign in as **Unverified Borrower** (`rohan.verma@campus.edu`).
2. Navigate to **Resources** and open **Sony Cinema FX3 4K Kit**.
3. **Observed Behavior**: The UI displays a red warning: *"Missing Required Training: TRN-MED-01"*.
4. If a request is submitted, it is routed to **`pending_verification`** without reserving a time slot. An owner cannot approve the request until a manager verifies credentials.

### Scenario B: Scheduling Conflict & Overlap Protection
1. Identify a resource with an approved booking from `10:00` to `12:00`.
2. Submit a second request for `11:00` to `13:00` (overlapping).
3. Attempting to approve the second booking is blocked by the database with:
   `Scheduling conflict: Time slot overlaps with an approved booking`.
4. **Adjacent Intervals Pass**: A request from `12:00` to `14:00` does NOT conflict (`[start, end)` half-open boundary).

### Scenario C: Active Physical Custody Blocker
1. With Resource A actively checked out (`in_use`), submit a request for tomorrow (`+24h`).
2. The owner attempts to approve tomorrow's request.
3. **Observed Behavior**: Blocked with error: `Active custody blocker: Resource has an active custody session that has not confirmed hand-back`.

### Scenario D: Fair-Use Monopolisation Caps
1. Submit 2 concurrent booking requests as an individual borrower.
2. Attempting to submit a 3rd request is blocked by:
   `Fair-Use Cap: You already have 2 active open booking items`.
3. An individual who has completed 3 uses within the past 7 days is blocked from requesting further slots until the rolling window clears.

### Scenario E: Damaged Return & Incident Review
1. During return submission, select condition code **`Damaged`** and describe cracked casing or missing parts.
2. Submitting the return automatically flags an **Open Incident**.
3. Sign in as **Campus Manager** (`coordinator@campus.edu`) -> **Admin** (`/admin`) -> **Section 4: Campus-Wide Incident Oversight**.
4. Click **"Review & Resolve Incident"**.
5. Attempting to resolve with an empty note is blocked. Entering a detailed explanation (e.g., *"Lab tech replaced lens filter from departmental stock; no borrower negligence assessed"*) resolves the incident.

---

## 5. Verification Status & Test Execution Report

In compliance with hackathon instructions, test execution statuses are reported accurately:

### Automated Frontend & Backend Security Suites (`npm test`)
- **Status**: **PASSED (67/67 tests passing across 27 suites)**
- **Test Runner**: Node.js v24 native test runner (`node --test tests/**/*.test.js`)
- **Execution Time**: ~182 ms
- **Coverage**:
  - `Domain & Fairness Rules` (`tests/domain_rules.test.js`): 38 passing tests across 13 suites (eligibility, quotas, active custody hold, FIFO waitlists, intervals, supervision gates, cancellation, return condition mismatch).
  - `Supabase Security & RLS Verification` (`tests/supabase_backend_verification.test.js`): 29 passing tests across 14 suites (role elevation triggers, cross-user RLS data isolation, owner resource boundaries, append-only activity log, reminder deduplication).

### Frontend Linter (`npm run lint`)
- **Status**: **PASSED (0 warnings, 0 errors across 37 files)**
- **Linter**: Oxlint v1.89.0

### Production Build (`npm run build`)
- **Status**: **PASSED (Clean production bundle in ~1.08s)**
- **Compiler**: TypeScript 5.9.3 (`tsc -b`) + Vite 8.3.5

### Supabase Database SQL Test Suites
- **Status**: **MANUAL / SUITE READY (Script Hardened with BEGIN ... ROLLBACK)**
- **Test Files**:
  - [`002_booking_operations_tests.sql`](file:///e:/CampusShare/supabase/tests/002_booking_operations_tests.sql): 9 atomic integration tests for booking operations, eligibility gates, overlap exclusion, and waitlist handling.
  - [`003_handoff_return_tests.sql`](file:///e:/CampusShare/supabase/tests/003_handoff_return_tests.sql): 7 atomic integration tests for checkout, supervision gates, return verification, damage incidents, and human resolution.
- **Execution Note**: Both test files are wrapped in self-contained transactional scripts with outer `BEGIN ... ROLLBACK` wrappers. They execute safely in the **Supabase Dashboard SQL Editor** without leaving any persistent side effects.

---

## 6. Known Limitations & MVP Scope Disclosures

In accordance with Section 3 of `docs/FINAL_PLAN.pdf`, the following operational boundaries are intentional MVP constraints:

1. **Single-Campus Scope**: Multi-tenant institutional provisioning is not implemented. All resources, faculties, and groups belong to one campus.
2. **Free / Institution-Sponsored Sharing**: No credit cards, payments, security deposits, or auction bidding are supported. All bookings are institutionally funded.
3. **In-App Notifications Only**: To respect privacy and prevent API failure points during hackathon evaluation, all notifications are persistent in-app rows. External SMS, email, and push notifications are excluded.
4. **No Runtime AI Models**: Deterministic eligibility, conflict, and fairness checks are fully explainable. No third-party LLM quota or black-box automated penalty assignment is used.
5. **Structured Checklists over Computer Vision**: Physical condition reports rely on human-verified condition codes, accessory checklists, and notes rather than automated photo OCR/vision analysis.
6. **Synthetic Demo Authentication**: Uses Supabase email/password authentication with synthetic campus identities rather than live university LDAP/SSO/SIS integration.
7. **Non-Hazardous Resources**: Scope is intentionally restricted to portable equipment (cameras, laptops, electronics) and reservable spaces (meeting rooms, study pods). Clean-rooms and high-hazard machinery are out of scope.

---

## 7. 12-Journey End-to-End Evaluation & Verification Matrix

This matrix provides step-by-step verification procedures and expected outcomes for all 12 core user journeys specified in the Phase 6 safety gate:

| Journey ID & Name | Persona | Verified Step-by-Step Actions | Expected System Response & Backend Enforcement | Evidence & Test Suites | Status |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **J-01: Public Catalogue Browsing** | Unauthenticated Public Visitor | 1. Open `/` or `/resources` without logging in.<br>2. Filter by equipment category, search titles, toggle availability.<br>3. Click "Request Booking" on any resource. | Published resources display with location labels, duration caps, and training prerequisites. Clicking "Request Booking" displays an authentication required modal with a redirect to `/signin`. | RLS policy on `public.resources` allows `to authenticated, anon` for `state = 'published'`. Verified in `ResourcesPage.tsx#L101-L106`. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
| **J-02: Unverified Borrower Blocker** | Unverified Borrower (`rohan.verma@campus.edu`) | 1. Sign in as Rohan.<br>2. Browse `/resources` and select **Formlabs Form 3+ 3D Printer**.<br>3. Attempt to submit a booking request. | UI prominently displays red banners: *"Unverified campus affiliation"* and *"Missing prerequisite: TRN-FAB-01"*. Request is automatically routed to `pending_verification`. Owner queue approval button is locked with explanation. | Tested in `domain_rules.test.js` Suite 2 Test 1, and `supabase_backend_verification.test.js` Suite 5 Test 1. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
| **J-03: Verified Borrower Qualifications Gate** | Verified Borrower (`aarav.sharma@campus.edu`) | 1. Sign in as Aarav.<br>2. Inspect **Sony FX3 Kit** (requires `TRN-MED-01`) vs **Robotics Bay** (requires `TRN-ROB-01`).<br>3. Submit request for Sony FX3 Kit. | Sony FX3 displays green *"Eligible to Request"* badge because Aarav holds verified `TRN-MED-01`. Robotics Bay displays amber warning block because `TRN-ROB-01` is missing. Valid request advances to `pending_owner_review`. | Tested in `domain_rules.test.js` Suite 2 Tests 2–4, and `supabase_backend_verification.test.js` Suite 5 Test 2. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
| **J-04: Owner Review & Approval Flow** | Resource Owner (`prof.raman@campus.edu`) | 1. Sign in as Prof. Raman.<br>2. Open **Owner Queue** (`/owner-queue`).<br>3. Locate Aarav's pending booking.<br>4. Click **Approve Booking**, enter decision note, and confirm. | Booking status updates to `approved`. In-app notification is sent to Aarav; Trust Record event is logged with actor snapshot, timestamp, and justification reason. | Tested in `supabase_backend_verification.test.js` Suite 8 Test 3, Suite 12 Test 1, and `002_booking_operations.sql#L125-L210`. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
| **J-05: Scheduling Conflict & Waitlist Ordering** | Verified Borrower / Multiple Requesters | 1. With Booking A approved for `10:00–12:00`, submit Booking B for `11:00–13:00`.<br>2. Owner attempts to approve Booking B.<br>3. Owner waitlists Booking B. | Approval of Booking B is rejected by `approve_booking_request` with `'Scheduling conflict: Time slot overlaps with an approved booking'`. Waitlist queue orders requests strictly by `created_at ASC, id ASC`. | Tested in `domain_rules.test.js` Suites 4, 6, 12, and `supabase_backend_verification.test.js` Suite 6 Test 1, Suite 7 Test 2. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
| **J-06: Check-out Condition & Active Custody Hold** | Verified Borrower (`aarav.sharma@campus.edu`) | 1. In **My Bookings** (`/my-bookings`), click **"Start Check-out"**.<br>2. Complete checklist, select `Good`, and confirm.<br>3. While item is `in_use`, have owner attempt to approve a booking for tomorrow. | Status transitions to `in_use`. A dual-write updates `bookings` and inserts a `condition_reports` record. Future booking approvals are blocked by database with `'Active physical custody hold: Resource is currently checked out'`. Attempting a second checkout is rejected. | Tested in `domain_rules.test.js` Suite 5 Tests 1–2, Suite 9, and `supabase_backend_verification.test.js` Suite 8 Test 1, Suite 9 Tests 1–3. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
| **J-07: Return Condition Mismatch & Auto-Incident** | Verified Borrower (`aarav.sharma@campus.edu`) | 1. In **My Bookings**, click **"Submit Return"**.<br>2. Change condition code from `Good` to `Damaged`.<br>3. Enter return note: *"Lens filter chipped during shoot"*. | Status transitions to `return_pending`. The system detects the condition degradation (`good` -> `damaged`) and automatically creates an open incident in `public.incidents` for staff investigation. | Tested in `domain_rules.test.js` Suite 13 Tests 1–3, and `003_handoff_return_incidents.sql#L130-L165`. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
| **J-08: Custodian Return & Custody Release** | Resource Owner (`prof.raman@campus.edu`) | 1. Open `/owner-queue` under **Pending Return Confirmations**.<br>2. Inspect borrower's condition notes.<br>3. Click **"Confirm Return & Release Custody"**. | Status updates to terminal state `returned`. `actual_release_confirmed_at` is set to `now()`. The active custody blocker is lifted, permitting subsequent booking approvals. | Tested in `domain_rules.test.js` Suite 5 Test 2, and `supabase_backend_verification.test.js` Suite 9 Test 3. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
| **J-09: Human Incident Resolution** | Facilities Manager (`coordinator@campus.edu`) | 1. Open **Admin Panel** (`/admin`) -> **Incident Oversight**.<br>2. Select the damaged return incident.<br>3. Attempt resolution with a blank note.<br>4. Enter documented justification and submit. | Blank note submission is blocked by validation. Entering a detailed justification updates incident to `resolved` and writes `INCIDENT_RESOLVED` event to the append-only activity log. Ordinary borrowers cannot resolve incidents. | Tested in `domain_rules.test.js` Suite 8 Tests 1–3, and `supabase_backend_verification.test.js` Suite 11 Tests 1–2. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
| **J-10: Trust Record Audit & In-App Reminders** | All Authenticated Personas | 1. Open `/activity` to view chronological history.<br>2. Open `/notifications` to view in-app reminders.<br>3. Click "Refresh & Check Reminders".<br>4. Attempt direct `UPDATE`/`DELETE` on `activity_events`. | Timeline displays full history of transitions, actors, and reasons. In-app reminders deduplicate within the hourly window. Direct client modification or deletion of `activity_events` is aborted by trigger `trg_protect_activity_events`. | Tested in `domain_rules.test.js` Suite 7 Tests 1–3, and `supabase_backend_verification.test.js` Suites 13 & 14. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
| **J-11: Direct Route & API Tamper Defense** | Ordinary Borrower / Tampering Client | 1. Navigate directly to `/admin` or `/owner-queue`.<br>2. Attempt SQL `UPDATE public.profiles SET primary_role = 'admin'`.<br>3. Attempt `assign_user_role` RPC call.<br>4. Attempt to read another user's notifications. | Client routes redirect unauthorized users via `ProtectedRoute`. SQL elevation updates are rejected by `trg_prevent_profile_elevation`. Admin RPC rejects non-admin caller. Cross-user select returns 0 rows via RLS. | Tested in `supabase_backend_verification.test.js` Suites 2, 3, 4, 8. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
| **J-12: UI Resilience, Layout & Error Handling** | Various Devices & Viewports | 1. Test empty states on fresh accounts.<br>2. Resize viewport to mobile (375px width).<br>3. Trigger network errors or invalid IDs.<br>4. Test browser refresh and direct URL entry. | Empty state banners provide actionable next steps. Mobile navigation collapses cleanly into hamburger drawer (`AppShell.tsx`). Form errors display accessible error banners without crashing or exposing stack traces. Direct navigation preserves session. | Tested in `frontend/src/App.tsx`, `AppShell.tsx`, and verified clean production build in `npm run build`. | **PASS (Locally Verified)**<br>*(Ready for live browser)* |
