# CampusShare — Hackathon Project Report & Submission Document

> **Challenge**: *"Unlock Underused Equipment and Spaces"* ([docs/PROBLEM_STATEMENT.txt](PROBLEM_STATEMENT.txt))<br>
> **Official Submission Criteria Compliance**: Prepared in accordance with Section *"WHAT TEAMS MUST SUBMIT"* (Items 1–7) of the official problem statement.<br>
> **Authoritative Build Plan Reference**: Final Pre-Build Plan v1.2 ([docs/FINAL_PLAN.pdf](FINAL_PLAN.pdf))<br>
> **Evaluation Guides**: [docs/JUDGE_TEST_GUIDE.md](JUDGE_TEST_GUIDE.md) | [docs/DEMO_SETUP.md](DEMO_SETUP.md) | [docs/DEPLOYMENT.md](DEPLOYMENT.md) | [docs/RELEASE_AUDIT.md](RELEASE_AUDIT.md)

---

## 1. Selected Use Case & Problem Evidence

### The Real-World Problem
Across universities, polytechnics, and research laboratories, millions of dollars worth of specialized equipment (cinema cameras, SLA 3D printers, spectrum analyzers, robotics flight cells) and project spaces remain idle outside scheduled class hours. Meanwhile, nearby students, capstone teams, and early-stage student researchers are blocked from progressing on innovative projects due to prohibitive rental costs or private purchase expenses.

Ordinary room/calendar booking systems display simple time availability, but completely fail to address the critical operational realities of institutional property sharing:
- **Trust & Accountability**: Who has physical possession of the asset right now?
- **Prerequisite Safety**: Does the borrower hold the mandatory lab induction or machine shop safety certification?
- **Custody Integrity**: What was the exact physical condition of the item before handoff and after return?
- **Anti-Monopolisation**: How do we prevent well-funded or hyperactive teams from monopolizing high-demand tools?
- **Human Oversight**: Why should access or dispute resolutions never be delegated to opaque, automated algorithms?

### The CampusShare Use Case
CampusShare is a dedicated single-campus resource and equipment sharing desk. It provides a secure, accountable digital chain-of-custody that protects institutional property while dramatically expanding student and faculty access.

---

## 2. Target Users and Resource Owners

1. **Student Borrowers (`borrower`)**:
   - Undergraduate, postgraduate, and capstone project students seeking specialized equipment or lab space for academic, research, or extracurricular projects.
2. **Resource Custodians & Lab Technicians (`owner`)**:
   - Faculty members, lab managers, and workshop superintendents who maintain custody and stewardship of departmental gear. They retain sole approval authority and confirm physical hand-backs.
3. **Campus Operations Managers (`manager`)**:
   - Institutional facility coordinators responsible for verifying campus affiliations, approving lab safety training credentials, certifying student project groups, and arbitrating condition disputes or damage incidents.
4. **Institutional Administrators (`admin`)**:
   - System administrators with authority to assign staff roles, audit system-wide activity, and inspect institutional fair-use policies.

---

## 3. The Proposed Solution & Architecture

CampusShare replaces open calendar reservations with a **10-Step Accountable Custody Lifecycle** enforced in PostgreSQL:

```
[1. Owner Lists Resource]
       ↓
[2. Borrower Discovers & Checks Eligibility]
       ↓
[3. Booking Request Submitted]
       ↓
[4. Automated Eligibility & Quota Gates Evaluated]
       ↓
[5. Custodian Reviews with Mandatory Rationale]
       ↓
[6. Approved / Waitlisted (FIFO) / Rejected]
       ↓
[7. Physical Check-Out with Initial Condition Checklist] → (Status: IN_USE / Active Custody Blocker Active)
       ↓
[8. Return Submission with End Condition Checklist] → (Status: RETURN_PENDING)
       ↓
[9. Owner Confirms Hand-Back & Releases Custody] → (Status: RETURNED / Custody Released)
       ↓
[10. Any Damage/Delay Flagged → Human Resolution Recorded in Append-Only Trust Record]
```

### System Architecture
- **Frontend Core**: React 19 + TypeScript 5.9 + Vite 8 SPA. Accessible, responsive, zero external UI component kits.
- **Backend & Database**: Supabase (PostgreSQL 15+), Row-Level Security (RLS) on all 10 tables, PL/pgSQL stored procedures (`SECURITY DEFINER SET search_path = public`).
- **State Machine Integrity**: Booking transitions are enforced in PostgreSQL functions; client-side direct updates to booking status or audit logs are strictly denied.
- **Append-Only Trust Record**: Immutable `activity_events` table protected by PostgreSQL triggers (`trg_protect_activity_events`) with zero update or delete privileges granted.

---

## 4. Key Features Developed During the Hackathon

1. **Role-Based Server-Enforced Security**: Explicit privilege boundaries for borrower, owner, manager, and admin. Elevation triggers prevent privilege escalation.
2. **Transparent Pre-Flight Eligibility Gates**: Automatic validation of verified campus affiliation and prerequisite safety induction codes (e.g. `TRN-MED-01`, `TRN-FAB-01`, `TRN-ROB-01`).
3. **Reasoned Custodian Decisioning**: Mandatory human explanation notes required for approvals, rejections, cancellations, and extensions.
4. **Active Physical Custody Blocker**: While a resource is in active physical custody (`in_use` or `return_pending`), all new approvals remain blocked regardless of requested time slot until physical hand-back is confirmed.
5. **Fair-Use Anti-Monopolisation Quotas**: Database-enforced quotas preventing hoarding:
   - *Individual*: Max 2 open items, max 3 completed uses in 7 days.
   - *Project Group*: Max 3 open items, max 5 completed uses in 7 days.
6. **FIFO Waiting Lists**: Competing requests are queued in strict first-in, first-out order with deterministic tie-breaking.
7. **Two-Point Physical Condition Checklists**: Initial handoff checklist and return checklist (`good`, `fair`, `damaged`, `missing_parts`) tracking damage progression.
8. **Automated Incident Flagging with Human Resolution**: Worsened return conditions automatically create an open incident for authorized human review; zero automated financial or disciplinary penalties.
9. **Supervision Handoff Gates**: Supervised research spaces require an assigned supervisor and supervisor confirmation prior to checkout.
10. **Persistent In-App Notification & Reminder Engine**: Deduplicated due-soon reminders (<60 min) and overdue notices evaluated on app open and every 5 minutes during active sessions.

---

## 5. Technology Stack & External Services

| Tier | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend Framework** | React 19.3 + TypeScript 5.9 | Reactive Single-Page Application |
| **Build Tooling** | Vite 8.3 + `@tailwindcss/vite` | Fast bundling, HMR, and CSS compilation |
| **Styling** | Tailwind CSS v4 + Institutional Theme | WCAG 2.1 AA compliant design system |
| **Routing** | React Router v7 (`react-router-dom`) | Client-side declarative routing and role guards |
| **Icons** | Lucide React (`lucide-react`) | Accessible SVG iconography |
| **Backend / Database** | Supabase (PostgreSQL 15+) | Relational storage, Auth, RLS, and RPCs |
| **Test Runner** | Node.js native test runner (`node --test`) | Fast, dependency-free domain and security tests |
| **Code Linter** | Oxlint v1.89 (`oxlint`) | Ultra-fast Rust-based static analysis |

---

## 6. AI Tools and Disclosures

In accordance with Hackathon Rule 5:
- **Development Tooling**: Google Antigravity (Advanced Agentic AI Coding Assistant) was utilized as an interactive pair programmer for code scaffolding, migration authoring, test suite generation, and systematic verification.
- **Production Runtime AI**: **Zero (0)** external LLMs, generative APIs, or black-box algorithms are executed at runtime. All access gates, conflict intervals, fair-use caps, and condition assessments are **deterministic, explainable PostgreSQL and TypeScript logic**. Important safety, custody, and penalty decisions remain strictly reviewable by an authorized human.

---

## 7. Privacy, Security, and Fairness Considerations

1. **Privacy**: User profiles store only institutional display names and campus email addresses. No government IDs, phone numbers, or private financial records are collected.
2. **Least Privilege**: Row-Level Security ensures users can only read their own bookings and private notifications. Custodians can only inspect bookings and incidents for their own assigned resources.
3. **Append-Only Immutability**: All decisions, handoffs, condition notes, and resolutions write atomically to `public.activity_events`. Triggers unconditionally reject `UPDATE` or `DELETE` operations on audit rows.
4. **Fairness**: Count-based caps eliminate calendar hoarding. Strict FIFO ordering prevents queue favoritism.

---

## 8. Known Limitations (MVP Scope Boundaries)

Per Section 3 of [docs/FINAL_PLAN.pdf](FINAL_PLAN.pdf):
1. **Single-Campus Scope**: Scoped to a single institutional boundary; multi-tenant cross-university federation is omitted.
2. **Non-Commercial Model**: Resources are shared free of charge; payment gateways, credit cards, and security deposit escrow are excluded.
3. **In-App Notifications**: Real-time persistent in-app notifications only; external SMS and email APIs were omitted to protect user privacy and avoid third-party delivery costs.
4. **Structured Text Checklists**: Condition reporting uses structured checklists and notes; photo computer vision is not included.
5. **Synthetic Demo Accounts**: Accounts are pre-configured for evaluation convenience and do not connect to live university LDAP/SSO directories.

---

## 9. Future Development Possibilities

1. **Hardware Smart Locker & Keybox Integration**: Bluetooth/RFID automated handoff kiosks for after-hours contactless key checkout.
2. **Multi-Campus Federation**: Inter-collegiate sharing partnerships between neighbouring institutions with mutual credit clearing.
3. **Institutional SSO Integration**: Seamless authentication via Shibboleth, SAML 2.0, or Google Workspace for Education.
4. **Consumables Inventory Tracking**: Automated restocking alerts for 3D printer resin, filament, CNC bits, and lens cleaning supplies.

---

## 10. Testing Instructions and Judge Access

- **Self-Service Evaluation Walkthrough**: [docs/JUDGE_TEST_GUIDE.md](JUDGE_TEST_GUIDE.md)
- **Manual Demo Setup & Seed Script**: [docs/DEMO_SETUP.md](DEMO_SETUP.md)
- **Production Deployment Runbook**: [docs/DEPLOYMENT.md](DEPLOYMENT.md)
- **Detailed Release Readiness Audit**: [docs/RELEASE_AUDIT.md](RELEASE_AUDIT.md)

---

## 11. Individual Participant Details & Submitter Contributions

- **Submission Type**: **Individual Submitter (Solo Developer)**
- **Participant Details**: Individual Hackathon Submitter *(Identity as registered in official hackathon submission form)*
- **Individual Authoring & Roles**:
  - *Full-Stack Architecture & Database Design*: Designed and authored the complete relational schema, 7 PostgreSQL migrations (`001`–`007`), Row-Level Security policies across all 10 tables, and PL/pgSQL stored procedures.
  - *Frontend Application & UI/UX*: Designed and implemented the accessible React 19 Single-Page Application, responsive `AppShell`, catalogue search/filter system, and all 10 resource-sharing lifecycle modal interfaces.
  - *Quality Assurance & Verification*: Designed and implemented the 67-test automated domain and security verification suite (`tests/domain_rules.test.js`, `tests/supabase_backend_verification.test.js`), executed static analysis with Oxlint, and developed the deployment runbooks.
  - *Assistance Disclosure*: Scaffolding, boilerplate structuring, and test generation assistance provided by Google Antigravity (AI pair programmer), as disclosed in Section 6. All architectural decisions, security boundaries, and domain rules were authored, reviewed, and verified by the individual submitter.

---

## 12. Disclosure of Templates, Libraries, and Existing Code

In accordance with Hackathon Rule 4:
- **Templates**: **None**. The project was initialized from a clean, blank Vite React template (`npx create-vite`). No pre-existing commercial web templates or application skeletons were used.
- **Open-Source Libraries**:
  - `react` & `react-dom` (v19.3.1, MIT)
  - `react-router-dom` (v7.18.5, MIT)
  - `@supabase/supabase-js` (v2.118.0, MIT)
  - `lucide-react` (v1.63.0, ISC)
  - `tailwindcss` & `@tailwindcss/vite` (v4.3.3, MIT)
  - `oxlint` (v1.89.0, MIT)
- **Pre-existing Code**: All database schema migrations, PL/pgSQL stored procedures, React components, and domain test suites were authored from scratch during the hackathon.

---

## 13. Submission Deliverables Checklist & Integrity Declaration

In compliance with the official submission requirements in [docs/PROBLEM_STATEMENT.txt](PROBLEM_STATEMENT.txt), the final deliverable readiness status is:

| Deliverable Item | Required Specification | Status | Evidence / Location |
| :---: | :--- | :---: | :--- |
| **Item 1** | Working product accessible to judges | **BUILD VERIFICATION PENDING** | Application source and hosting instructions are present. Re-run the production build and complete a browser smoke test before presenting a hosted URL; see [docs/DEPLOYMENT.md](DEPLOYMENT.md). |
| **Item 2** | Source-code repository with evaluation access | **PUBLIC REPOSITORY AVAILABLE** | [AdityaB411/CampusShare](https://github.com/AdityaB411/CampusShare), default branch `main`. |
| **Item 3** | Project document covering use case, architecture, features, security | **COMPLIANT** | Detailed throughout this document ([docs/SUBMISSION_REPORT.md](SUBMISSION_REPORT.md)). |
| **Item 4** | Testing instructions & judge credentials | **COMPLIANT** | Step-by-step 10-step script in [docs/JUDGE_TEST_GUIDE.md](JUDGE_TEST_GUIDE.md). |
| **Item 5** | Team & participant details | **COMPLIANT** | Documented in Section 11 (Individual Submitter registration). |
| **Item 6** | Role & contribution of each team member | **COMPLIANT** | Documented in Section 11 (Individual end-to-end authoring and verification). |
| **Item 7** | Disclosure of templates, libraries, and AI tooling | **COMPLIANT** | Documented in Section 6 (AI disclosures) and Section 12 (template/library disclosures). |

### Submission Integrity Declaration
- **No Fabricated Data**: No artificial live user statistics, fake survey responses, or simulated live deployment metrics are included.
- **Accurate Verification Disclosures**: The earlier repository baseline reported 67/67 tests passing. The current revision's frontend tests, lint, and production build have not been freshly run in this review because the local environment could not resolve GitHub hostnames. Connected Supabase schema checks and rollback-contained database smoke tests did pass; browser end-to-end verification remains pending.
- **Official Submission Form Link**: [Google Submission Form](https://forms.gle/QTD1ZRuPX37Yef37A) (from line 1 of official problem statement).
