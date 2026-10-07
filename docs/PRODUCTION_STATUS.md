# Production status

Live record of the go-live work. An item is **Completed** only after it was verified on the real
environment. Last updated: 7 Oct 2026.

Legend: `[ ] Not started` · `[~] In progress` · `[x] Completed` · `[!] Blocked (needs owner action)`

| # | Area | Status | Notes |
| --- | --- | --- | --- |
| 1 | Hosting (Netlify) | `[~] In progress` | Project `stayflow-pg` created, https://stayflow-pg.netlify.app. Generated secrets set. Not deployed yet: the build reads the database (landing page prices), so it waits on item 2. Git-connected builds need the repo linked in the Netlify UI. |
| 2 | PostgreSQL | `[!] Blocked` | Needs a managed database in Mumbai (Neon recommended, region AWS ap-south-1). Owner creates the account. |
| 3 | Domain / DNS | `[!] Blocked` | Needs a domain the owner has bought. Until then the pilot runs on stayflow-pg.netlify.app (HTTPS by Netlify). |
| 4 | Environment variables | `[~] In progress` | Set: AUTH_SECRET, CRON_SECRET, DATA_ENCRYPTION_KEY (secret, all deploy contexts), NEXT_PUBLIC_SITE_URL, DEMO_MODE=false, TZ. Missing: database and integration keys. See `PRODUCTION_ENV.md`. |
| 5 | Database migrations | `[ ] Not started` | Run automatically by the production build (`prisma migrate deploy`, unpooled URL). 10 additive migrations. |
| 6 | Backups / PITR | `[!] Blocked` | Depends on item 2. See `DATABASE_RECOVERY.md`. |
| 7 | Razorpay | `[!] Blocked` | Needs the owner's Razorpay account (test keys first; live needs KYC). Code verified: signatures, capture-only, refunds, idempotency. |
| 8 | WhatsApp | `[!] Blocked` | Needs Meta Business verification, a number and approved templates. See `WHATSAPP_PRODUCTION.md`. |
| 9 | Resend (email) | `[!] Blocked` | Needs a Resend account and DNS records on the owner's domain (depends on item 3). |
| 10 | R2 / S3 storage | `[!] Blocked` | Needs a Cloudflare R2 (or S3) private bucket and keys. |
| 11 | Authentication | `[~] In progress` | Verified locally on production builds. Production check after first deploy. First Super Admin is created with `npm run bootstrap:prod` (tested on a scratch database). |
| 12 | Security | `[~] In progress` | Code review done and fixes verified locally (see `PRODUCTION_PLAN.md`). Tenant-isolation test on production pending. |
| 13 | Monitoring / logging | `[~] In progress` | Structured logs, error codes, health page, `/api/health` exist. `ERROR_WEBHOOK_URL` not set yet. |
| 14 | Staging tests | `[ ] Not started` | Plan in `PRODUCTION_TEST_RESULTS.md`. |
| 15 | Production smoke tests | `[ ] Not started` | `node scripts/smoke.mjs` targets the seeded demo data, so on production only the safe manual checklist runs. |
| 16 | Final launch status | `[ ] Not started` | |

## Known platform limits (free Netlify plan)

- Server functions are limited to about 10 seconds on the free plan. Large Excel imports (thousands of
  rows) and the daily automation for many customers can hit that limit. Fine for a pilot of a few
  PGs; upgrade to Netlify Pro before scaling.
