# Backup and disaster recovery

Status: **documented, not yet configured.** Nothing in this repository creates backups by itself.
Backups exist only once the steps below are done on the production database provider and storage
bucket. Record the date each step was completed at the bottom of this file.

## What must be protected

| Data | Where | Why it matters |
| --- | --- | --- |
| PostgreSQL database | Managed provider (Neon / Supabase / RDS, Mumbai region) | Every resident, invoice, payment, ledger and audit row |
| Uploaded files | S3 / Cloudflare R2 bucket (`S3_BUCKET`) | KYC documents, complaint and proof photos, payment attachments |
| Secrets | Netlify environment variables | `DATA_ENCRYPTION_KEY` decrypts clients' Razorpay/WhatsApp secrets — losing it makes them unrecoverable |

## 1. Database backups

1. **Point-in-time recovery (PITR)** — turn it on at the provider:
   - Neon: Project → Settings → History retention → at least 7 days (paid plans allow 30).
   - Supabase: Database → Backups → enable PITR add-on (7–28 days).
   - RDS: automated backups, retention 14 days, backup window 01:00–02:00 IST.
2. **Daily logical dump** (independent copy, survives provider account problems). Run from a
   scheduled job (GitHub Actions cron or a small VM) with a read-only role:

   ```bash
   pg_dump "$DIRECT_URL" --format=custom --no-owner --no-privileges \
     --file "stayflow-$(date +%F).dump"
   # upload to a separate bucket/account with object lock or versioning
   aws s3 cp "stayflow-$(date +%F).dump" "s3://stayflow-backups/db/" --storage-class STANDARD_IA
   ```

3. **Retention:** daily dumps 30 days, monthly (1st of month) 12 months, yearly 8 years
   (Indian tax records must be kept 8 years).
4. **Encryption:** the backup bucket must be private, encrypted at rest, in a different account or
   project from production, with versioning on.

## 2. File storage backups

- Turn on **bucket versioning** (R2: object versioning; S3: versioning + lifecycle to delete
  non-current versions after 90 days).
- Weekly replication to the backup account (`rclone sync r2:stayflow-prod r2-backup:stayflow-files`).
- Never make the bucket public; StayFlow serves files only through `/api/uploads/<id>` with access checks.

## 3. Secrets

- Store `DATA_ENCRYPTION_KEY`, `AUTH_SECRET`, `CRON_SECRET` and provider keys in a password manager
  (owner + one trusted person) in addition to Netlify.
- `DATA_ENCRYPTION_KEY` must never change once data exists. Rotating it requires a re-encryption script.

## 4. Restore procedure

1. Create a new database (or branch on Neon) — never restore over production first.
2. PITR: restore to the timestamp just before the incident. Logical dump:
   `pg_restore --clean --no-owner --dbname "$NEW_DIRECT_URL" stayflow-YYYY-MM-DD.dump`
3. Run `npx prisma migrate deploy` against the restored database (no-op if up to date).
4. Point a staging deploy at it; run `node scripts/smoke.mjs <staging-url>` and check a few
   invoices, payments and ledgers by hand.
5. Switch production `DATABASE_URL` to the restored database; redeploy.
6. Post an announcement to customers (Super Admin → Announcements) if data between the restore
   point and the incident was lost; list what they need to re-enter.

## 5. Disaster scenarios

| Scenario | Action | Target |
| --- | --- | --- |
| Bad deploy | Netlify → Deploys → publish previous deploy | 5 min |
| Bad migration | Restore PITR to before deploy, redeploy previous build | 1 h |
| Accidental data deletion | PITR to just before; or targeted restore of rows from a branch | 1–4 h |
| Provider outage | Restore latest logical dump to another provider, update env, redeploy | 4–8 h |
| Leaked secret | Rotate it (except `DATA_ENCRYPTION_KEY`, see above), revoke sessions | 1 h |

## 6. Recovery testing

Once a month: restore the latest dump into a scratch database, run migrations and the smoke test
against a preview deploy, and record the result below. A backup that has never been restored is
not a backup.

## Log

| Date | Step | By |
| --- | --- | --- |
| | PITR enabled | |
| | Daily dump job running | |
| | Bucket versioning on | |
| | First restore test passed | |
