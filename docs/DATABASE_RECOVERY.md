# Database recovery

Status: **not configured** — no production database exists yet. Full procedures are in
`docs/backup-and-recovery.md`; this file records the actual production setup once it exists.

| Item | Value |
| --- | --- |
| Provider | Neon, project `stayflow-us` (free plan) |
| Region | AWS US East 2 (Ohio), next to Netlify's free function region. Planned move to Singapore with Netlify Pro. |
| Point-in-time recovery | Neon restores to any moment inside its history window. The free plan's window is short; paid plans allow days (check Neon's current pricing page). **Pilot target: at least 7 days on a paid plan.** Not yet enabled. |
| Daily logical backup | `pg_dump` job (GitHub Actions or a small VM) to a separate private bucket. Not yet set up. |
| Retention | Daily 30 days, monthly 12 months, yearly 8 years |
| Last restore test | Never |

## Owner steps in Neon

1. Create project **stayflow-prod**, Postgres 16 or 17, region **AWS Asia Pacific 1 (Mumbai)**.
2. Settings → **History retention / Restore window**: set the maximum your plan allows (aim for 7 days or more).
3. Create a second branch **staging** from `main` for staging tests (its own connection string).
4. Dashboard → **Connect**: copy the pooled and the direct connection strings for `main` into your
   password manager. Give them to the deploy step as `DATABASE_URL` (pooled) and
   `DATABASE_URL_UNPOOLED` (direct) — set them yourself with
   `netlify env:set DATABASE_URL "<value>" --context production --secret` so they never appear in chat.

## Restore (Neon)

1. Neon → Branches → **Restore** (or create a branch from a point in time) to just before the incident.
   Restore into a new branch first, never over `main` directly.
2. Point a staging deploy at the new branch, check a few invoices, payments and ledgers by hand.
3. Promote the branch (or switch `DATABASE_URL`/`DATABASE_URL_UNPOOLED` to it) and redeploy.
4. Record the incident and the restore test below.

## Log

| Date | Action | By |
| --- | --- | --- |
| 7 Oct 2026 | Project created in Ohio; data moved from Singapore with pg_dump/pg_restore, row counts verified | Claude |
| | Restore window set | |
| | Daily dump running | |
| | First restore test passed | |
