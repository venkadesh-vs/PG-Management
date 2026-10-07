# Go-live checklist

Work through this top to bottom before the first paying customer. Tick each line only when it has
actually been done on the production environment — not when the code supports it.

## 1. Infrastructure (you)

- [ ] Managed PostgreSQL in Mumbai region created; pooled `DATABASE_URL` set in Netlify
- [ ] Point-in-time recovery on, daily dump job running, first restore test passed
      (see `docs/backup-and-recovery.md` — currently **documented, not configured**)
- [ ] Netlify site connected to `main`; production context runs `prisma migrate deploy`
- [ ] Custom domain + HTTPS; `NEXT_PUBLIC_SITE_URL` set to it
- [ ] `AUTH_SECRET` (≥ 32 chars), `CRON_SECRET` (≥ 16), `DATA_ENCRYPTION_KEY` (32 bytes base64)
      generated fresh for production and stored in a password manager
- [ ] `DEMO_MODE=false` — this also switches off every simulated payment path
- [ ] Scheduled function `daily-automation` enabled (06:00 IST); first run visible in
      Super Admin → System health
- [ ] `ERROR_WEBHOOK_URL` set (Slack/Discord/Google Chat) and a test alert received
- [ ] `TRUST_PROXY_HEADERS` left unset on Netlify (Netlify's own client-IP header is used)

## 2. Integrations (you)

| Integration | Steps | Doc |
| --- | --- | --- |
| Razorpay (platform subscriptions) | Live keys, webhook URL + secret, events incl. `payment.captured`, `refund.processed`, `subscription.*` | `docs/payments-setup.md` |
| Razorpay (each PG's rent) | Owner connects their own keys in Settings → Payments; webhook per account | `docs/payments-setup.md` |
| WhatsApp (Meta Cloud API) | Business verification, number, approved templates, webhook verify token + app secret | `docs/whatsapp-setup.md` |
| Email (Resend) | Verified sending domain, `EMAIL_FROM` | `docs/environments.md` |
| Storage (R2/S3) | Private bucket, versioning on, keys set | `docs/storage-setup.md` |
| GST / legal identity | `PLATFORM_GSTIN`, legal name, address, grievance officer, contact | `docs/environments.md` |

Test each in **Razorpay test mode / staging first**: a rent payment, a refund from the Razorpay
dashboard (must show as refunded/reversed in StayFlow), a subscription charge, a WhatsApp template
send, a password-reset email, and a photo upload.

## 3. Product data (you)

- [ ] Plans and prices reviewed in Super Admin → Plans (limits: PGs, beds, staff, WhatsApp/month,
      storage)
- [ ] Never run `npm run db:seed` against production (it refuses, but don't try)
- [ ] Your own Super Admin account created with a strong password; demo accounts not present
- [ ] Terms, privacy, refund and shipping policy pages read and approved by you

## 4. Release verification (each deploy)

```bash
npm run verify                                   # typecheck, lint, unit tests, build
node scripts/smoke.mjs https://<staging-url>     # 92 end-to-end checks against staging
```

Then by hand on a phone (390px): owner login → add PG → rooms → check-in → rent invoice →
record payment → resident app shows receipt → checkout → settlement PDF.

## 5. First customer

- [ ] Lead converted from Super Admin → Sales CRM (Start trial), owner receives the invite link
- [ ] Owner completes the setup wizard (`/app/setup`) or the Excel import (`/app/import`)
- [ ] Owner connects their Razorpay and WhatsApp in Settings
- [ ] Support ticket path tested end to end (owner → Super Admin reply)
