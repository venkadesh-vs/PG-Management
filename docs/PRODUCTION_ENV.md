# Production environment

Names only. Values live in Netlify (Project → Configuration → Environment variables) and in your
password manager. Never paste a value into Git, docs, screenshots or chat.

Netlify project: `stayflow-pg` · https://stayflow-pg.netlify.app

## Set (7 Oct 2026)

| Variable | Contexts | How it was set |
| --- | --- | --- |
| `AUTH_SECRET` | production, previews, branches (secret) | 48 random bytes, generated on the deploy machine |
| `CRON_SECRET` | production, previews, branches (secret) | 32 random bytes |
| `DATA_ENCRYPTION_KEY` | production, previews, branches (secret) | 32 random bytes, base64. **Copy it into your password manager now** (`netlify env:get DATA_ENCRYPTION_KEY --context production`). Losing it makes clients' saved Razorpay/WhatsApp secrets unreadable. Never change it. |
| `NEXT_PUBLIC_SITE_URL` | all | `https://stayflow-pg.netlify.app` (change when the custom domain is live) |
| `DEMO_MODE` | all | `false` (no demo accounts, no simulated payments) |
| `TZ` | all | `Asia/Kolkata` |

## To set when the accounts exist

| Variable | Source |
| --- | --- |
| `DATABASE_URL` | Neon → Connection string, **pooled**, add `&connection_limit=1` |
| `DATABASE_URL_UNPOOLED` | Neon → Connection string, **direct** (used only by migrations) |
| `PAYMENT_PROVIDER` | `razorpay` |
| `PAYMENT_KEY_ID`, `PAYMENT_KEY_SECRET` | Razorpay → Account & Settings → API keys (test first, live after KYC) |
| `PAYMENT_WEBHOOK_SECRET` | You choose it when creating the webhook (below) |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | `resend`; Resend → API keys; e.g. `StayFlow <no-reply@yourdomain>` |
| `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `s3`; Cloudflare R2 → bucket + API token (region `auto`) |
| `WHATSAPP_*` | See `WHATSAPP_PRODUCTION.md` |
| `ERROR_WEBHOOK_URL` | A Slack, Discord or Google Chat incoming webhook |
| `PLATFORM_GSTIN`, `PLATFORM_LEGAL_NAME`, `PLATFORM_STATE_CODE`, `PLATFORM_ADDRESS` | Your business registration |
| `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_BUSINESS_ADDRESS`, `NEXT_PUBLIC_JURISDICTION_CITY`, `NEXT_PUBLIC_GRIEVANCE_OFFICER`, `NEXT_PUBLIC_GRIEVANCE_EMAIL`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_CONTACT_PHONE` | Shown on the policy pages |

Do **not** set `SEED_PASSWORD`, `ALLOW_SEED` or `TRUST_PROXY_HEADERS` in production.

## Webhook URLs

| Provider | URL | Events |
| --- | --- | --- |
| Razorpay (platform subscriptions) | `https://<site>/api/webhooks/razorpay/platform` | `payment.captured`, `payment.failed`, `refund.processed`, `subscription.*` |
| Razorpay (each PG's own account) | shown to the owner in Settings → Payments | `payment.captured`, `payment.failed`, `refund.processed` |
| WhatsApp (Meta) | `https://<site>/api/webhooks/whatsapp` | `messages` |

Check the exact paths in `docs/payments-setup.md` and `docs/whatsapp-setup.md` before entering them.

## First Super Admin

After the first successful production deploy, from the project folder:

```bash
DATABASE_URL="<pooled url>" NEXT_PUBLIC_SITE_URL=https://stayflow-pg.netlify.app \
BOOTSTRAP_ADMIN_EMAIL=<your email> BOOTSTRAP_ADMIN_NAME="<your name>" \
BOOTSTRAP_LINK_FILE=<path outside the repo> npm run bootstrap:prod
```

It creates the plans and your Super Admin without touching anything that exists, and writes a
single-use set-password link (valid 72 hours) to the link file. Open it, set your password, delete
the file.
