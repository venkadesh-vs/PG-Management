# Payments setup (Razorpay)

StayFlow uses two separate kinds of Razorpay account. They are never mixed.

| Flow | Whose account | Configured where | Money goes to |
| --- | --- | --- | --- |
| SaaS subscription (Pay now + AutoPay) | Platform (StayFlow) | Server env | StayFlow |
| Rent from residents | Each PG owner's own | `/app/settings/payments` (per organization) | The PG owner |

If no platform keys are set, the platform runs in **demo mode**. Every demo payment is flagged `isDemo` and labelled "Demo" in the UI. No money moves.

---

## 1. Platform account (StayFlow's own)

### Environment

```env
PAYMENT_PROVIDER="razorpay"
PAYMENT_KEY_ID="rzp_live_xxxxxxxx"        # Dashboard → Account & Settings → API Keys
PAYMENT_KEY_SECRET="xxxxxxxxxxxxxxxx"
PAYMENT_WEBHOOK_SECRET="a-long-random-string"   # the secret you type on the webhook
DATA_ENCRYPTION_KEY="<32 random bytes, base64>" # encrypts owners' Razorpay secrets
NEXT_PUBLIC_SITE_URL="https://app.example.com"  # used to build webhook URLs
```

Generate `DATA_ENCRYPTION_KEY` with:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
If you rotate this key, every owner has to reconnect Razorpay.

### Razorpay Dashboard

1. **Enable Subscriptions.** Go to Products → Subscriptions and activate it. Also ask Razorpay support to enable **UPI AutoPay** and **eMandate** if they are not already on. Cards work by default.
2. **Webhook.** Go to Account & Settings → Webhooks → Add new webhook.
   - URL: `https://<your-domain>/api/webhooks/razorpay/platform`
   - Secret: the same value as `PAYMENT_WEBHOOK_SECRET`.
   - Active events:
     - `subscription.authenticated`
     - `subscription.activated`
     - `subscription.charged`
     - `subscription.pending`
     - `subscription.halted`
     - `subscription.cancelled`
     - `subscription.completed`
     - `payment.captured`
     - `payment.failed`
3. **Auto-capture.** Account & Settings → Payment capture → set to automatic. Pay now accepts `authorized` payments too, but auto-capture means the money actually settles.

The old URL `/api/webhooks/payment` still works. It delegates to the platform handler, so existing configurations keep running. Prefer the new URL for new setups.

### How it behaves

- **Pay now.** Every unpaid invoice on `/app/subscription` gets a Pay now button.
  1. The button creates a platform order with notes `{kind: 'subscription_invoice', invoiceId, organizationId}` and opens Razorpay Checkout.
  2. The server verifies the checkout signature, then fetches the payment and its order from Razorpay. It checks the status (`captured` or `authorized`), the order, the amount and the notes.
  3. Only then is the invoice marked PAID.
  4. The `payment.captured` webhook does the same thing. Both paths are idempotent on the payment id, so whichever arrives second is a no-op.
- **AutoPay.**
  1. Set up AutoPay gets or creates a cached Razorpay plan for the monthly amount (`GatewayPlan`).
  2. It creates a Razorpay subscription with `total_count` 120 and `start_at` set to the next billing date. The owner is redirected to the hosted `short_url` to approve the mandate by UPI AutoPay, card or eMandate.
  3. `subscription.authenticated` or `subscription.activated` turns the mandate ACTIVE.
  4. On each `subscription.charged`, the oldest unpaid invoice is settled. If the nightly billing run has not raised the invoice yet, the webhook claims the cycle and raises it, using the same race-safe claim as the billing run.
  5. `pending` moves the subscription to PAST_DUE with a grace deadline. `halted` also marks the mandate FAILED. Both notify the owners.
  6. `cancelled` or `completed` marks the mandate REVOKED.
- **Nightly billing.** For a subscription with an active Razorpay mandate, StayFlow never debits on its own. It raises the invoice with a grace deadline and waits for the charge webhook. If no charge arrives by `graceEndsAt`, the normal suspension applies.
- **Reactivation.** When an invoice is settled, any subscription with no unpaid invoices goes back to ACTIVE. The organization goes back to ACTIVE when nothing is overdue. This applies to Pay now, AutoPay charges and the admin MARK_PAID action, which all use the same helper. CANCELLED organizations are left alone.
- **Repricing.** If a PG's price changes while a Razorpay mandate is active or pending, the Razorpay subscription is **cancelled** and the owner is asked to re-authorise at the new amount.
  - Why: a UPI AutoPay or eMandate mandate is authorised for a fixed maximum, and Razorpay does not allow plan changes on UPI or eMandate subscriptions.
  - Re-authorising also gets the owner's explicit consent to the new price.
  - The current period is already paid. The next invoice is raised as usual and can be paid with Pay now until AutoPay is set up again.
- **Cancel AutoPay** cancels the Razorpay subscription immediately.

---

## 2. Each PG owner's own account (rent)

The owner does this once, at **Settings → Online payments** (`/app/settings/payments`):

1. Sign up or log in at <https://dashboard.razorpay.com> and complete KYC so live mode is available.
2. Go to **Account & Settings → API Keys**, then **Generate Key** in **Live** mode. Copy the Key ID (`rzp_live_…`) and the Key Secret. Razorpay shows the secret only once.
3. Go to **Account & Settings → Webhooks → Add new webhook**:
   - URL: shown on the StayFlow page. It looks like `https://<your-domain>/api/webhooks/razorpay/org/<organizationId>`.
   - Secret: any strong string you choose.
   - Active events: `payment.captured`, `payment.failed`.
4. Paste the Key ID, Key Secret and webhook secret into StayFlow and click **Verify & save**.
   - StayFlow makes a cheap API call (list one order) to prove the keys work before storing them.
   - Secrets are encrypted with AES-256-GCM. They are never sent back to the browser.

Once connected, a resident's **Pay** button works like this:

1. It opens Razorpay Checkout for an order on the **owner's** account, with notes `{kind: 'rent', organizationId, residentId, invoiceId?}`.
2. The resident can pay one invoice's balance or the whole outstanding balance. The amount always comes from the database.
3. On success, the server verifies the signature with the owner's key secret. It then fetches the payment and order from Razorpay to check the status, amount, notes and resident.
4. It records the payment with `recordPayment`: method `UPI` for UPI payments, `GATEWAY` otherwise, with the gateway fields set and `isDemo` false.
5. The org webhook records the same payment if the resident closed the app first. Both are idempotent on `gatewayPaymentId`.

**Fallbacks:**
- Not connected, or the owner's keys stop working: residents see the UPI deep link and Copy UPI ID option, and the owner marks those payments received by hand. The UPI ID is set in Settings.
- When the owner's keys stop working, the error is also shown on the owner's payments settings page.
- On a demo deployment, residents also get a clearly-labelled demo payment.

Test keys (`rzp_test_…`) work too. The settings page shows a **Test mode** badge.
