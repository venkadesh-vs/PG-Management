# Production status

Live record of the go-live work. An item is **Completed** only after it was verified on the real
environment. Last updated: 7 Oct 2026.

Legend: `[ ] Not started` · `[~] In progress` · `[x] Completed` · `[!] Blocked (needs owner action)`

| # | Area | Status | Notes |
| --- | --- | --- | --- |
| 1 | Hosting (Netlify) | `[x] Completed` | Project `stayflow-pg` in team venkadesh-vs, https://stayflow-pg.netlify.app, builds from GitHub `main`. Deploys verified (home, login, signup, health 200; security headers present). Functions run in us-east-2; changing region needs a paid Netlify plan. |
| 2 | PostgreSQL | `[x] Completed` (region caveat) | Neon project `stayflow-us`, PostgreSQL 18, **US East 2 (Ohio)**, same region as the free Netlify functions (query latency 2 ms, was 208 ms from Singapore). Moved 7 Oct 2026 with pg_dump/pg_restore; all 72 tables and 107 rows verified identical. Old Singapore project kept until the owner confirms, then delete it. For paying customers: Netlify Pro + functions and database in Singapore. Rotate the password (it was shared in chat). |
| 3 | Domain / DNS | `[!] Blocked` | Needs a domain the owner has bought. Until then the pilot runs on stayflow-pg.netlify.app (HTTPS by Netlify). |
| 4 | Environment variables | `[~] In progress` | Set: AUTH_SECRET, CRON_SECRET, DATA_ENCRYPTION_KEY (secret, all deploy contexts), NEXT_PUBLIC_SITE_URL, DEMO_MODE=false, TZ. Missing: database and integration keys. See `PRODUCTION_ENV.md`. |
| 5 | Database migrations | `[x] Completed` | Applied by the production build; `prisma migrate status` up to date; 72 tables, 214 indexes. Plans and Super Admin created with `npm run bootstrap:prod`. |
| 6 | Backups / PITR | `[x] Daily backup` / `[ ] PITR` | Daily pg_dump to private Backblaze B2 (GitHub Actions, 02:00 IST, 30 days + monthly), first run verified 10 Oct. Neon free plan restore window is short; longer PITR needs a paid plan. |
| 7 | Razorpay | `[~] Test mode` | Test keys live. Verified: resident rent payment → webhook → paid + receipt; failed payments; owner AutoPay mandate + cancel. Pending: refund (Razorpay test balance), resident AutoPay (needs Recurring Payments enabled), live KYC. |
| 8 | WhatsApp | `[!] Blocked` | Needs Meta Business verification, a number and approved templates. See `WHATSAPP_PRODUCTION.md`. |
| 9 | Resend (email) | `[!] Blocked` | Needs a Resend account and DNS records on the owner's domain (depends on item 3). |
| 10 | File storage | `[x] Completed` | Backblaze B2 (S3-compatible, private bucket `stayflow-uploads-vs2026`, us-east-005). Live upload verified: stored, served via signed URL to the owner, refused without login. |
| 11 | Authentication | `[x] Completed` | Super Admin login works on production; signup → owner session verified live; anonymous API access returns 401. |
| 12 | Security | `[x] Completed` | Live tenant-isolation test 23/23 (two test organisations: lists, by-id reads, edits, checkout, rooms, search, exports, PDFs, pages). |
| 13 | Monitoring / logging | `[~] In progress` | Structured logs, error codes, health page, `/api/health` exist. `ERROR_WEBHOOK_URL` not set yet. |
| 14 | Staging tests | `[ ] Not started` | Plan in `PRODUCTION_TEST_RESULTS.md`. |
| 15 | Production smoke tests | `[ ] Not started` | `node scripts/smoke.mjs` targets the seeded demo data, so on production only the safe manual checklist runs. |
| 16 | Final launch status | `[ ] Not started` | |

## Known platform limits (free Netlify plan)

- Server functions are limited to about 10 seconds on the free plan. Large Excel imports (thousands of
  rows) and the daily automation for many customers can hit that limit. Fine for a pilot of a few
  PGs; upgrade to Netlify Pro before scaling.
