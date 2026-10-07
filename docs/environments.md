# Environments and secrets

Three separate environments. They never share a database, a storage bucket or provider keys.

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Where | Your computer (`npm run dev`) | Netlify deploy preview / `staging` branch | Netlify production (`main`) |
| Database | Local PostgreSQL | Separate managed DB (can be a Neon branch) | Managed PostgreSQL, Mumbai region, PITR on |
| `DEMO_MODE` | `true` | `true` or `false` | **`false`** |
| Payments | Demo, or Razorpay **test** keys | Razorpay **test** keys | Razorpay **live** keys |
| WhatsApp | Demo | Demo or a test number | Approved business number + templates |
| Email | Demo (outbox) | Resend with a test domain | Resend with your verified domain |
| Storage | `local` | Separate R2/S3 bucket | Production R2/S3 bucket, versioning on |
| Seed data | Yes (`npm run db:seed`) | Optional | **Never** (the seed deletes everything; it refuses in production) |

## Rules

- Production secrets live only in Netlify's environment settings (and your password manager).
  Never copy them into `.env` on a laptop. `.env` is git-ignored; never commit it.
- Migrations run automatically only on the production context (`netlify.toml`). Deploy previews
  must use their own `DATABASE_URL`.
- Test new provider keys in staging first.

## Variables

Required in every environment:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Serverless: pooled URL, e.g. Neon pooler with `?pgbouncer=true&connection_limit=1` |
| `AUTH_SECRET` | ≥ 32 random characters; production refuses shorter or `change-me…` values |
| `CRON_SECRET` | ≥ 16 characters; the scheduled function sends it |
| `DATA_ENCRYPTION_KEY` | 32 random bytes, base64. **Never change once data exists.** |
| `NEXT_PUBLIC_SITE_URL` | Full URL of that environment; used in every link sent to people |
| `DEMO_MODE` | `false` in production |

Integrations (each falls back to an honest demo mode when empty):

| Area | Variables |
| --- | --- |
| Razorpay (platform subscriptions) | `PAYMENT_PROVIDER=razorpay`, `PAYMENT_KEY_ID`, `PAYMENT_KEY_SECRET`, `PAYMENT_WEBHOOK_SECRET` |
| WhatsApp | `WHATSAPP_PROVIDER=meta`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` |
| Email | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` |
| Storage | `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| GST | `PLATFORM_GSTIN`, `PLATFORM_LEGAL_NAME`, `PLATFORM_STATE_CODE`, `PLATFORM_ADDRESS` |
| Legal identity | `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_BUSINESS_ADDRESS`, `NEXT_PUBLIC_JURISDICTION_CITY`, `NEXT_PUBLIC_GRIEVANCE_OFFICER`, `NEXT_PUBLIC_GRIEVANCE_EMAIL`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_CONTACT_PHONE` |
| Alerts | `ERROR_WEBHOOK_URL` (Slack/Discord/Google Chat incoming webhook) |

Each client's own Razorpay and WhatsApp credentials are entered in their Settings and stored
encrypted with `DATA_ENCRYPTION_KEY`; they are not environment variables.
