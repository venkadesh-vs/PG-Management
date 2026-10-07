# Production test results

Each test records where it ran, when, and the result. "Local" means a production build
(`next build` + `next start`) against the local demo database — useful, but not a substitute for
staging with real providers.

## Local production-build results (7 Oct 2026)

| Test | Result |
| --- | --- |
| Typecheck, lint (0 errors), 347 unit tests | PASS |
| 97 pages × all roles at 390 px | PASS |
| Smoke suite (`scripts/smoke.mjs`) | 92/92 PASS |
| Targeted API checks (CRM, expenses, P&L, import, search, exports, maintenance, checkout, support, security fixes) | 95 PASS, 0 real failures |
| Tenant isolation (other organisation's ticket 404, restricted manager sees only own PGs, search/exports scoped) | PASS |
| Production bootstrap script on an empty database, run twice (idempotent) | PASS |

## Production (7 Oct 2026)

| Test | Result |
| --- | --- |
| Deploy, migrations, health (`db: ok`) | PASS |
| Super Admin bootstrap + login | PASS |
| Multi-tenancy: two test organisations created through real signup, PG A data never reachable by PG B (lists, by-id API, edit, checkout, rooms, search, exports, invoice PDF, pages) and vice versa | PASS 23/23 |
| First invoice at check-in | FAIL then fixed: the transaction exceeded Prisma's 5 s default because of US↔Singapore latency; timeout raised to 20 s. Re-test after deploy below. |

## Staging (real providers, test mode) — not run yet

| # | Test | Flow | Result | Date |
| --- | --- | --- | --- | --- |
| 1 | Online rent payment | Resident → invoice → Razorpay test → webhook → payment row → receipt | — | |
| 2 | Refund | Razorpay dashboard refund → `refund.processed` → payment shows refunded/reversed | — | |
| 3 | WhatsApp | Test send to owner's own number → delivered tick | — | |
| 4 | Password reset | Forgot password → Resend email received → reset → login | — | |
| 5 | Photo upload | Complaint photo → R2 object exists → shows in app → not publicly reachable | — | |
| 6 | Checkout | Notice → checkout → settlement and deposit → PDF → bed vacant | — | |
| 7 | Repair | Complaint → task → vendor → estimate → approve → cost → expense | — | |
| 8 | Multi-tenancy | Two test organisations; PG A data never visible to PG B (pages, search, exports, direct URLs) | — | |

## Production smoke (safe, no money) — not run yet

Landing, login/logout, dashboard, navigation, add PG/room/bed, add a test resident, invoice view,
payment settings page, staff, complaint, reports, one file upload. Test records are created in a
clearly named test organisation and archived afterwards. No real payment without owner approval.
