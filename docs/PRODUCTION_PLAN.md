# Production-readiness plan

Audit result and execution plan for the 30-phase "sales-ready SaaS" specification.
Rule: extend what exists; never rebuild, never duplicate a module, additive migrations only.

## Phase 0 — audit summary (7 Oct 2026)

Already in place before this plan: multi-tenant auth with invites/resets, dynamic roles and
permissions, switchable modules, editable lookups, PG/floor/room/bed management with edit and
archive, 6-step check-in, CSV resident import, enquiries and bookings, rent engine with late fees,
payments with oldest-first allocation, deposits and checkout settlement, complaints with SLA and
photos, staff tasks, food/grocery/inventory, visitors, announcements, resident requests, dashboard
with needs-attention and vacancy loss, reports and CSV/PDF exports, Razorpay (rent + subscription
AutoPay), WhatsApp with templates/retries/opt-out, email, S3/R2 storage, daily automation with a
run lease, activity log, security headers and rate limits, 115 unit tests, 90-step smoke test, CI.

Schema groundwork for every phase was added in migrations `20261007090000_production_readiness`
and `20261007091000_audit_event_types` (additive only).

## Execution batches
| Batch | Phases | Scope |
| --- | --- | --- |
| 1 | 2, 3 | Subscription lifecycle, webhook event log + idempotency, plan engine, entitlements, usage limits |
| 1 | 6, 7 | Recurring/one-time charges, discounts, rent revisions, credit/debit notes, payment reversal/refund, UTR, daily collection report |
| 1 | 1, 25 | Onboarding wizard with saved progress, Getting Started checklist, owner quick actions |
| 2 | 4, 13 | Sales CRM for platform leads, Super Admin control centre (MRR/ARR/churn, customers, health, announcements, audited admin actions) |
| 2 | 8, 9, 10 | Expenses (vendor, bill no., attachment, recurring, approval, void), P&L (monthly, PG-wise, trends, per bed), vacancy intelligence |
| 2 | 5 | Migration wizard: Excel/CSV with column mapping, rooms/beds/balances, transaction-safe, error download |
| 3 | 17–20 | Transfers with history and rent difference, advanced checkout (inspection, clearance, lock, PDF), maintenance vendor/estimate/approval/cost→expense, assets by location with checkout deductions |
| 3 | 11, 12 | Notification centre (all channels, statuses, per-type settings), WhatsApp management (test message, per-type switches) |
| 3 | 21–23 | Global search extension, full audit log viewer, exports for every area |
| 4 | 15, 16, 24 | Monitoring (structured logs, cron/integration health, error codes), multi-PG consolidation, Help centre + support tickets |
| 4 | 26–28 | Security review, UX quality pass, test expansion |
| 4 | 14, 29, 30 | Backup/DR docs, environments, go-live checklist verification |

Each batch: build → typecheck → unit tests → production build → every page as every role at 390px →
smoke test → targeted API tests → commit → push.
