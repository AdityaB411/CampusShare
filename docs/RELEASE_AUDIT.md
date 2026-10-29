# CampusShare — Current Release & Verification Status

**Reviewed:** 29 October 2026  
**Repository:** [AdityaB411/CampusShare](https://github.com/AdityaB411/CampusShare)  
**Scope:** Source tree, connected Supabase schema/access controls, and rollback-safe database smoke tests.

## Current status

The database-side security and lifecycle changes have been applied to the connected Supabase project. This is **not yet a fully release-verified frontend build**: the local environment could not resolve GitHub hostnames, so the current frontend test suite, lint, TypeScript build, and browser end-to-end flow could not be run here.

## Changes verified on the database

- Public tables: 10; all have row-level security enabled.
- Legacy extension_requests table: removed; the 7 extension-state fields are on bookings.
- Role assignment is separated from affiliation/owner verification; protected direct role elevation is denied to non-admin API users.
- Booking/custody RPCs validate actors and workflow state, use row locking where appropriate, and enforce owner/supervisor responsibilities.
- Resource pause/archive requires authorized, verified ownership/staff access and blocks active physical custody.
- Project-group creation and membership decisions generate Trust Record events; affected users receive notifications; visibility is scoped.
- Waitlisting is a documented owner/staff decision. FIFO order uses persisted bookings.waitlisted_at, with a deterministic booking-ID tie-breaker; the UI separates review order from waitlist order.
- The database-owned campusshare-due-reminders job is active on */15 * * * *; its three most recent recorded runs succeeded.
- Public custody lookup remains intentionally callable by anonymous clients for catalogue availability, but returns only resource IDs. Supabase may report the generic SECURITY DEFINER advisory for this function.

## Smoke tests

Nine transaction-contained SQL smoke scenarios passed, covering authentication enforcement, role separation, booking approval, extension limits and decisions, checkout/return, incident handling, supervision, active-custody pause prevention, group lifecycle auditing, row-level group-event privacy, and waitlist authorization/FIFO. Fixtures were rolled back. A final integrity query confirmed that public tables and test-user records remained empty.

Repeatable regression suites live under [supabase/tests/](../supabase/tests/). They are intended for a **disposable test database only**; do not run fixture-mutating test scripts against production.

## Local checks still required

Run from frontend/ on a machine with network access and Node.js/npm installed:

    npm ci
    npm test
    npm run lint
    npm run build

Then perform a browser smoke test for sign-in/sign-up, resource discovery, booking approval, checkout/return, incident resolution, notifications, and owner/staff access boundaries. These frontend checks are not claimed as passed in this audit.

## Deployment caution

The repository migrations use numbered filenames, while the connected Supabase project records timestamped migration-history entries. **Do not run supabase db push against the live project until that history is intentionally reconciled.** See the [deployment guide](DEPLOYMENT.md). The follow-up migrations currently committed to the repository are 008–023; they have been applied to the connected project.

## Advisor notes

Supabase's generic security advisor still reports the public custody RPC and authenticated-executable SECURITY DEFINER functions. These warnings do not automatically mean every RPC is unsafe; the public custody exception is deliberate and minimal, while the privileged workflow RPCs require authorization checks. The advisories should nevertheless be revisited before public production launch. Unused-index findings are informational and were not used as a reason to remove indexes from an empty development database.
