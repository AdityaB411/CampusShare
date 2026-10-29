# CampusShare — Self-Service Judge Evaluation Guide

> **Document Type**: Self-Service Evaluation Guide & Ordered Demonstration Script<br>
> **Challenge**: *"Unlock Underused Equipment and Spaces"* ([docs/PROBLEM_STATEMENT.txt](PROBLEM_STATEMENT.txt))<br>
> **Architecture Plan**: Final Pre-Build Plan v1.2 ([docs/FINAL_PLAN.pdf](FINAL_PLAN.pdf))<br>
> **Related Documents**: [docs/DEMO_SETUP.md](DEMO_SETUP.md) | [docs/DEPLOYMENT.md](DEPLOYMENT.md) | [docs/RELEASE_AUDIT.md](RELEASE_AUDIT.md)

---

## 1. Quick Access & Evaluation Overview

Welcome, Evaluator! CampusShare is a single-campus resource-sharing platform designed to transform idle laboratory equipment and specialized project spaces into safe, shared institutional assets.

### How to Access the Application
- **Deployed Production URL**: Open the deployed URL provided in your submission details.
- **Local Evaluation Mode**: If testing locally, start the frontend and open `http://localhost:4173`:
  ```bash
  cd frontend
  npm install
  npm run build
  npm run preview
  ```

### Instant Sign-In / Role Personas
On the **Sign In** screen (`/signin`), you can use the **Judge Quick-Fill** buttons to instantly populate the campus email for any role persona (enter the password configured during demo setup or provided in your evaluation pack):

| Role Persona | Fictional Email | Purpose in Evaluation |
| :--- | :--- | :--- |
| **Verified Borrower** | `aarav.sharma@campus.edu` | Has verified affiliation and `TRN-FAB-01` induction. Submits valid requests, completes check-out/return. |
| **Unverified Borrower** | `rohan.verma@campus.edu` | Has unverified affiliation and missing training. Demonstrates the **Eligibility Gate**. |
| **Resource Custodian (Owner)** | `prof.raman@campus.edu` | Faculty custodian of Media & Fabrication assets. Approves/rejects requests and confirms hand-back. |
| **Campus Operations Manager** | `coordinator@campus.edu` | Verifies user affiliations, safety certifications, and conducts human incident reviews. |
| **System Administrator** | `admin@campus.edu` | Manages institutional fair-use policies and inspects campus audit records. |

---

## 2. Ordered 10-Step Demonstration Script (Complete Lifecycle)

Follow this step-by-step walkthrough to experience the complete resource-sharing journey without needing developer assistance:

### Step 1: Discover Resources as a Visitor
1. Navigate to the homepage or **Resources** (`/resources`).
2. Filter the catalogue by **Type** (`Equipment` or `Space`) and search for `"Sony"` or `"Printer"`.
3. Notice that published items display location, maximum reservation duration, and required safety training prerequisites.

### Step 2: Test the Eligibility Blocker
1. Sign in as **Unverified Borrower** (`rohan.verma@campus.edu`).
2. Open **Formlabs Form 3+ SLA 3D Printer**.
3. Observe the red eligibility warning: *"Missing prerequisite: TRN-FAB-01"* and *"Unverified campus affiliation"*.
4. Click **"Request Booking"**. Submit the form.
5. In **My Bookings** (`/my-bookings`), observe that the request is placed in **`pending_verification`**. It does not block calendar slots or advance to owner review until campus management verifies credentials.

### Step 3: Verified Borrower Requests a Booking
1. Sign in as **Verified Borrower** (`aarav.sharma@campus.edu`).
2. Open **Formlabs Form 3+ SLA 3D Printer** (or **Sony Cinema FX3 4K Kit**).
3. Observe the green badge: **"Eligible to Request"** (verified affiliation and active `TRN-FAB-01` induction).
4. Click **"Request Booking"**.
5. Select a 3-hour time slot for tomorrow, provide a legitimate purpose (*"Final Year Capstone Enclosure Prototyping"*), and submit.
6. The booking status becomes **`pending_owner_review`**.

### Step 4: Custodian Reviews & Approves with Reason
1. Sign in as **Resource Custodian** (`prof.raman@campus.edu`).
2. Go to **Owner Queue** (`/owner-queue`).
3. Locate Aarav's booking under **Pending Booking Requests**.
4. Click **"Approve"**.
5. Notice that approval requires a human rationale (or accepts the default verified note). Confirm approval.
6. The status transitions to **`approved`**. An atomic notification and Trust Record event are generated.

### Step 5: Check-Out with Initial Condition Checklist
1. Sign in as **Verified Borrower** (`aarav.sharma@campus.edu`).
2. Go to **My Bookings** (`/my-bookings`). Locate the approved booking.
3. Click **"Start Check-out"**.
4. Complete the condition checklist (clean resin tank, intact build platform) and select condition code **"Good"**.
5. Confirm handoff. The booking status transitions to **`in_use`** (active custody).

### Step 6: Verify Active Physical Custody Blocker
1. While the 3D printer is `in_use`, sign in as another borrower and request the same printer for next week.
2. Sign in as Owner (`prof.raman@campus.edu`) and attempt to approve next week's request.
3. Observe the **Active Custody Blocker**: The database blocks approval because the physical asset has not confirmed return. This prevents double-allocating resources when prior borrowers hold custody.

### Step 7: Return Submission with Worsened Condition
1. Sign in as **Verified Borrower** (`aarav.sharma@campus.edu`).
2. In **My Bookings**, click **"Submit Return"**.
3. Select condition code **"Damaged"** and enter a note: *"Resin vat film punctured during removal; tank drained safely."*
4. Submit the return.
5. The booking status becomes **`return_pending`**, and an **Incident Report** is automatically created for human review (zero automated penalty).

### Step 8: Custodian Confirms Hand-Back & Releases Custody
1. Sign in as **Resource Custodian** (`prof.raman@campus.edu`).
2. Go to **Owner Queue** (`/owner-queue`) -> **Pending Return Confirmations**.
3. Inspect the borrower's return condition notes.
4. Click **"Confirm Return & Release Custody"**.
5. The booking transitions to **`returned`** (Terminal State). Physical custody is now released.

### Step 9: Campus Management Resolves Incident
1. Sign in as **Campus Operations Manager** (`coordinator@campus.edu`).
2. Open **Admin & Operations Desk** (`/admin`) -> **Incident Oversight**.
3. Locate the damaged vat incident. Click **"Review / Resolve"**.
4. Enter an explicit human resolution note: *"Vat film replaced from lab consumables inventory. Borrower followed proper safety protocol; no penalty assessed."*
5. Submit resolution. The incident transitions to **`resolved`**.

### Step 10: Inspect Append-Only Trust Record & Notifications
1. Navigate to **Activity** (`/activity`).
2. Observe the complete, chronological audit timeline: actor snapshot, action, status progression (`pending_owner_review` -> `approved` -> `in_use` -> `return_pending` -> `returned`), decision reasons, and timestamps.
3. Navigate to **Notifications** (`/notifications`). Inspect decision notices, reminders, and unread badge counters.

---

## 3. Honest Disclosure of Known Limitations

Per Section 3 of [docs/FINAL_PLAN.pdf](FINAL_PLAN.pdf), CampusShare is scoped specifically for the hackathon challenge:

1. **Single-Campus Boundary**: Tenancy is scoped to a single campus community. Multi-institutional federation is intentionally out of scope.
2. **Non-Commercial Model**: Resources are shared free of charge or via institutional sponsorship. Credit card processing and security deposit escrow are omitted.
3. **Strictly In-App Notifications**: Alerts, due-soon reminders, and overdue notices are delivered in-app with deterministic deduplication. External SMS/email APIs were omitted to protect privacy and prevent spam.
4. **Structured Text Checklists**: Condition reporting uses structured multi-point checklists and notes; photo-based computer vision inspection is not included.
5. **Deterministic Rule Engine**: All access gates, conflict intervals, and fair-use quotas are evaluated deterministically in PostgreSQL and TypeScript; zero external LLM API dependencies exist at runtime.
6. **Synthetic Demo Accounts**: Accounts are pre-configured for evaluation convenience and do not connect to live university LDAP/SSO directories.
