# StayFlow roadmap (from the product requirements document)

Status of every PRD area against the codebase. ✅ built · 🟡 partial · ⏳ in progress · ❌ not started.
The PRD's own rule applies: ship the MVP (§100) first; AI (§54–57) comes after.

## MVP (§100) — must be complete before selling

| PRD area | Status | What is left |
| --- | --- | --- |
| Authentication, sign-up, invites, reset (§5, §80) | ✅ | — |
| Organizations, multi-tenancy (§6, §75) | ✅ | — |
| Roles & permissions, switchable features (§5) | ⏳ | Settings UI, API + page enforcement, lookup-driven forms |
| PG / floors / rooms / beds (§23–25) | 🟡 | Edit/archive screens (on `wip/paused-work`), Reserve/Release/Block actions, bed side-panel |
| Residents + profile (§26–27) | ✅ | Edit screen (on `wip/paused-work`) |
| Check-in (§28, §16) | ✅ | Connected success animation (§16) |
| Checkout + settlement (§29) | 🟡 | Utilities/damage on final invoice, refund recording, "mark refund paid" |
| Rent engine, invoices, late fees (§33) | ✅ | — |
| Payments + receipts (§34, §81) | ✅ | Gateway live keys (owner's own Razorpay) |
| Deposits (§35) | 🟡 | Deductions/adjustments/refund ledger UI |
| Expenses (§45) | ✅ | Edit/delete (on `wip/paused-work`) |
| Complaints + worker tasks (§41–42) | 🟡 | Photo upload + photo proof (needs file storage §79), SLA timers (§43) |
| Lead CRM for residents + booking (§30, §32) | ❌ | Resident-enquiry pipeline, visits, token payment, booking → check-in |
| WhatsApp (§52) | ✅ | Meta account + template approval (owner side) |
| Basic resident app (§50) | 🟡 | Visitors, leave, requests |
| Basic reports + CSV/PDF (§83) | 🟡 | Excel export, P&L PDF |

## Design & experience (§7–21)

| Area | Status | What is left |
| --- | --- | --- |
| Design system tokens (§9–12) | 🟡 | Shift brand to deep indigo/blue-violet with warm-grey neutrals (§10); semantic status colours (§11) |
| Animation system (§13–17) | 🟡 | Foundation done; screen-level work paused |
| Loading / empty / micro-interactions (§18–20) | 🟡 | Skeletons exist; PRD empty-state copy |
| Mobile owner nav + Quick Action (§21) | ❌ | Bottom nav (Home/Residents/Beds/Tasks/More) + “+ Quick action” |
| Owner dashboard “needs attention” (§22) | 🟡 | Attention list, vacancy-loss figure (§48) |
| Marketing site + SEO pages (§63–71) | 🟡 | Feature/location/comparison pages, structured data |

## V2 (§101)

Food intelligence (§39), inventory transactions (§40), electricity meters & anomalies (§36–37), staff leave/advance/salary (§44), PG website builder (§31), advanced reports, referral (§109).

## V3 (§102)

AI assistant and daily brief (§54–56), revenue/vacancy intelligence and smart pricing (§47–49), WhatsApp command centre (§53), AI Excel import (§57), benchmarking (§59).

## Engineering (§87–90)

Unit tests ✅ (92) · smoke test ✅ · CI ✅ · error reporting ✅ · E2E browser tests ❌ · S3 storage ❌ · backups doc ❌.
