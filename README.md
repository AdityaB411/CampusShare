# CampusShare — Campus Resource & Equipment Desk

> Single-campus resource-sharing desk for students, faculty, and project groups to discover, request, and responsibly share underused equipment and specialized project spaces.
>
> Built for the hackathon challenge: **Unlock Underused Equipment and Spaces** ([docs/PROBLEM_STATEMENT.txt](file:///e:/CampusShare/docs/PROBLEM_STATEMENT.txt))<br>
> Authoritative Build Plan: **Final Pre-Build Audit & Implementation Plan v1.2** ([docs/FINAL_PLAN.pdf](file:///e:/CampusShare/docs/FINAL_PLAN.pdf))<br>
> Evaluation Walkthrough: **[Self-Service Judge Guide](file:///e:/CampusShare/docs/JUDGE_TEST_GUIDE.md)**<br>
> Manual Demo Setup & Seed Data: **[Demo Setup Guide](file:///e:/CampusShare/docs/DEMO_SETUP.md)**<br>
> Production Deployment & Hosting: **[Deployment Guide](file:///e:/CampusShare/docs/DEPLOYMENT.md)**<br>
> Full Release Readiness Audit: **[Release Audit Report](file:///e:/CampusShare/docs/RELEASE_AUDIT.md)**<br>
> Hackathon Submission Report: **[Submission Report](file:///e:/CampusShare/docs/SUBMISSION_REPORT.md)**<br>
> Prompts & Results Log: **[Prompts & Results Log](file:///e:/CampusShare/docs/PROMPTS_AND_RESULTS.md)**

---

## 1. Project Overview

Colleges, makerspaces, and research laboratories often own valuable specialized resources (cameras, fabrication gear, robotics bays, testing kits, project spaces) that remain idle for long periods. Nearby students and project teams cannot access them due to prohibitive rental or purchase costs.

Standard booking systems display calendar availability, but fail to address **trust, custody, prerequisite safety, and fair access**.

**CampusShare** solves this through an accountable, 10-step lifecycle:
1. **Owner-Controlled Listing**: Verified custodians publish portable equipment and meeting/project spaces with explicit duration limits, access rules, safety training requirements, and supervision flags.
2. **Transparent Eligibility Gates**: Campus affiliation and prerequisite safety induction codes (e.g., `TRN-FAB-01`) are checked automatically before requests can be submitted or approved.
3. **Reasoned Custodian Decisions**: Approvals, rejections, and waitlisting require mandatory human justification. FIFO queue order is maintained by default.
4. **Physical Custody Tracking**: Mandatory start and end condition checklists (`good`, `fair`, `damaged`, `missing_parts`). An active physical custody hold prevents subsequent approvals until actual hand-back is confirmed.
5. **Fair-Use Caps & Anti-Monopolisation**: Count-based quotas (Individual: 3 uses / 7 days, 2 open items; Project Group: 5 uses / 7 days, 3 open items) prevent hoarding of scarce campus resources.
6. **Append-Only Trust Record**: Tamper-resistant activity event log (`activity_events`) recording actor, action, previous/new status, timestamps, and decision reasons. Normal clients have zero update or delete privileges.
7. **In-App Persistent Notifications & Reminder Engine**: Deduplicated due-soon reminders (<60 min) and overdue custody alerts run on app open and every 5 minutes while a session is active. Strictly no SMS, email, or runtime AI dependencies.

---

## 2. Technology Stack

- **Frontend Core**: React 19 + TypeScript 5.9 + Vite 8 (located in `./frontend`)
- **Styling & UI**: Tailwind CSS with custom institutional design system, Lucide Icons (`lucide-react`)
- **Routing**: React Router v7 (`react-router-dom`)
- **Backend / Data Store**: Supabase (PostgreSQL 15+, Supabase Auth, Row-Level Security, PL/pgSQL RPC functions)
- **Test Runner**: Node.js native test runner (`node --test tests/**/*.test.js`)
- **Linter**: Oxlint v1.89 (`oxlint`)

---

## 3. Database Schema & Migration Architecture

All database schema definitions, RLS policies, constraints, and secure functions are partitioned into 7 modular SQL migrations located in `supabase/migrations/`:

| Migration | Purpose | Key Objects & Functions |
| :--- | :--- | :--- |
| **[`001_core_schema.sql`](file:///e:/CampusShare/supabase/migrations/001_core_schema.sql)** | Core relational tables & RLS | `profiles`, `resources`, `bookings`, `project_groups`, `group_members`, `profile_qualifications`, `condition_reports`, `incidents`, `notifications`, `activity_events` |
| **[`002_booking_operations.sql`](file:///e:/CampusShare/supabase/migrations/002_booking_operations.sql)** | Booking transaction RPCs | `submit_booking_request`, `approve_booking_request` (with `FOR UPDATE` lock), `reject_booking_request`, `waitlist_booking_request`, `cancel_booking`, `request_booking_extension`, `decide_booking_extension` |
| **[`003_handoff_return_incidents.sql`](file:///e:/CampusShare/supabase/migrations/003_handoff_return_incidents.sql)** | Custody lifecycle & incidents | `confirm_checkout`, `submit_return`, `confirm_return`, `report_incident`, `resolve_incident` |
| **[`004_auth_and_roles.sql`](file:///e:/CampusShare/supabase/migrations/004_auth_and_roles.sql)** | Role boundaries & verifications | `assign_user_role`, `verify_user_status`, `verify_qualification`, `request_owner_verification`, `request_affiliation_verification` |
| **[`005_resource_catalogue.sql`](file:///e:/CampusShare/supabase/migrations/005_resource_catalogue.sql)** | Catalogue management | `create_resource`, `update_resource`, `archive_resource`, `create_project_group`, `verify_project_group`, `decide_group_membership` |
| **[`006_resource_lifecycle.sql`](file:///e:/CampusShare/supabase/migrations/006_resource_lifecycle.sql)** | Active custody & timeline | `get_active_resource_custody`, `get_booking_timeline` |
| **[`007_notifications_and_reminders.sql`](file:///e:/CampusShare/supabase/migrations/007_notifications_and_reminders.sql)** | In-app reminder scheduler | `generate_due_reminders`, `mark_all_notifications_as_read`, `get_unread_notifications_count` |

---

## 4. Getting Started

### Prerequisites
- Node.js (v20+ recommended, v24 LTS verified)
- npm (v10+)

### Setup, Build & Run Commands

```bash
# 1. Navigate to the frontend directory
cd frontend

# 2. Install dependencies
npm install

# 3. Configure environment variables (optional: fallback demo mode runs automatically when omitted)
cp ../.env.example .env.local
# Edit .env.local and populate VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 4. Run automated test suite (67 tests across 27 suites)
npm test

# 5. Run static linter (0 errors, 0 warnings across 37 files)
npm run lint

# 6. Build production bundle (outputs to frontend/dist)
npm run build

# 7. Start local preview server (serves dist/ on http://localhost:4173)
npm run preview
```

### Environment Variables & Hosting Configuration
- `VITE_SUPABASE_URL`: HTTPS project URL from Supabase Settings -> API.
- `VITE_SUPABASE_ANON_KEY`: Public anonymous JWT token (`anon` `public`).
- `VITE_CAMPUS_ID`: (Optional) Institution partition key (defaults to `main-campus`).
- **SPA Routing Fallbacks**: Pre-configured in [`frontend/vercel.json`](file:///e:/CampusShare/frontend/vercel.json) (Vercel) and [`frontend/public/_redirects`](file:///e:/CampusShare/frontend/public/_redirects) (Netlify & Cloudflare Pages).
- **Secret Isolation Guarantee**: `.env.local`, database passwords, and the Supabase `service_role` secret key are strictly excluded by `.gitignore` and must **never** be included in frontend code.

---

## 5. Judge Testing & Demonstration Personas

Synthetic institutional accounts have been pre-configured for evaluation. You can sign in using these accounts at `/signin` (or click the quick-fill buttons on the login screen):

| Role | Email Address | Intended Evaluation Purpose |
| :--- | :--- | :--- |
| **Verified Borrower** | `aarav.sharma@campus.edu` | Submits valid bookings; has verified affiliation and `TRN-FAB-01` training. |
| **Unverified Borrower** | `rohan.verma@campus.edu` | Tests **Eligibility Blocker**; unverified affiliation and missing safety induction. |
| **Resource Owner / Custodian** | `prof.raman@campus.edu` | Media Lab & Makerspace custodian; reviews requests, approves/rejects, confirms handoffs and returns. |
| **Campus Facilities Manager** | `coordinator@campus.edu` | Verifies user affiliations, safety credentials, project groups, and conducts human incident reviews. |
| **System Administrator** | `admin@campus.edu` | Assigns system roles, inspects full campus audit logs, and configures fair-use policies. |

For detailed walkthroughs of the 10-step main journey, 5 exception test cases, and known limitations, consult the **[Self-Service Judge Guide](file:///e:/CampusShare/docs/JUDGE_TEST_GUIDE.md)** and **[Demo Setup Guide](file:///e:/CampusShare/docs/DEMO_SETUP.md)**.

---

## 6. Verification Status Summary

- **Automated Test Suite (`npm test`)**: **67/67 tests passed** across 27 test suites (~170 ms).
- **Frontend Linter (`npm run lint`)**: **0 warnings, 0 errors** across 37 files.
- **Production Build (`npm run build`)**: **Clean bundle** built in ~1.4s.
- **Supabase Integration Suites (`supabase/tests/`)**:
  - `002_booking_operations_tests.sql`: 9 self-contained transactional integration tests for booking rules, active custody hold, and waitlist.
  - `003_handoff_return_tests.sql`: 7 self-contained transactional integration tests for checkout, supervision gates, return verification, damage incidents, and human resolution.
  - *Status*: Ready for manual execution in the Supabase Dashboard SQL Editor.

---

## 7. Known Scope Boundaries (MVP)

Per Section 3 of `docs/FINAL_PLAN.pdf`:
- **Single Campus**: Single-institution boundary; multi-tenant provisioning is excluded.
- **Non-Commercial**: Free / institution-sponsored bookings; no payments, credit cards, or security deposits.
- **In-App Notifications**: Strictly in-app notices; external SMS/email APIs excluded for privacy and reliability.
- **No Runtime AI Models**: Deterministic, explainable rule engine; no external AI API quota dependencies.
- **Structured Condition Forms**: Structured checklist codes and text notes; no photo computer vision.
- **Synthetic Accounts**: Supabase Auth email/password authentication; no live university LDAP/SSO integration.
