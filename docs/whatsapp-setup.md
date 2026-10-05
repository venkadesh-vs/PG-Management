# WhatsApp setup

StayFlow sends rent reminders, receipts, complaint updates, announcements, welcome and checkout messages, and account invites and password resets over the **WhatsApp Business Cloud API** (Meta).

There are three ways a message can go out. StayFlow picks one for each message:

| Mode | When | Sender |
| --- | --- | --- |
| **Own number** | The organization connected its number under *Settings → WhatsApp* | The PG's own WhatsApp Business number |
| **Platform** | `WHATSAPP_PROVIDER=meta` and the platform credentials are set | The single StayFlow WhatsApp Business number |
| **Demo** | No credentials | Nothing is sent. The message is saved as `DEMO_NOT_SENT` and shown in the outbox |

An organization's own number always wins over the platform number.

---

## 1. Platform number (one-time, by the StayFlow operator)

1. **Meta Business account.** Create one at business.facebook.com, then finish **Business Verification** (Security Centre). You'll need GST or incorporation documents plus a website and domain that match. Until the business is verified you're capped at about 250 business-initiated conversations a day, and the display name stays pending.
2. **Meta app.** Go to developers.facebook.com → *Create app* → type **Business**, and link it to the verified business. Add the **WhatsApp** product.
3. **WhatsApp Business Account (WABA) and phone number.** In WhatsApp Manager, add a phone number that isn't registered on the WhatsApp or WhatsApp Business app. Verify it by SMS or voice, set the **display name** (Meta reviews it), and note the **Phone number ID**.
4. **Permanent token.** Go to Business Settings → *Users → System users* → add an **Admin** system user. Assign it the app and the WABA with full control. Then *Generate token*, choose the app, set expiry to *Never*, and grant the permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Temporary tokens from the API-setup page expire after 24 hours, so don't use those.
5. **App secret.** In the app, go to *App settings → Basic → App secret*.
6. **Environment variables:**

   ```env
   WHATSAPP_PROVIDER=meta
   WHATSAPP_PHONE_NUMBER_ID=<phone number id>
   WHATSAPP_ACCESS_TOKEN=<permanent system-user token>
   WHATSAPP_API_VERSION=v21.0
   WHATSAPP_WEBHOOK_VERIFY_TOKEN=<any long random string you choose>
   WHATSAPP_APP_SECRET=<app secret>
   DATA_ENCRYPTION_KEY=<32 random bytes, base64>   # needed for organizations' own numbers
   NEXT_PUBLIC_SITE_URL=https://<your domain>
   ```

7. **Webhook.** In the app, go to *WhatsApp → Configuration → Webhook → Edit*:
   - Callback URL: `${appUrl}/api/webhooks/whatsapp`, for example `https://app.stayflow.in/api/webhooks/whatsapp`
   - Verify token: the value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - Then **Subscribe** to the `messages` field. That one field carries delivery statuses and inbound replies.

   Every POST must carry a valid `X-Hub-Signature-256`, which is checked against `WHATSAPP_APP_SECRET`. If the secret isn't set, every POST is rejected.
8. **Submit the templates** in section 3 under WhatsApp Manager → *Message templates*. Use exactly the names, categories, languages and text given there.
9. **Payment method.** Add one in WhatsApp Manager. Conversations are billed to the WABA.
10. Set the app to **Live** mode.

## 2. An organization's own number (optional, per client)

A PG owner who wants residents to see their own business name goes through steps 1–4 above under **their own** Meta business. Then, in StayFlow, they open **Settings → WhatsApp** (OWNER only) and enter:

- Phone number ID
- WhatsApp Business Account ID
- Permanent access token (a system-user token with `whatsapp_business_messaging`)
- Meta App secret (optional; see below)

StayFlow checks the token by calling `GET https://graph.facebook.com/<ver>/<phoneNumberId>?fields=display_phone_number,verified_name` before saving anything. The credentials are stored AES-256-GCM encrypted with `DATA_ENCRYPTION_KEY`. Disconnecting puts the organization back on the platform number.

The owner must also **submit the same templates** (section 3) in their own WABA. Templates are approved per WABA, so the platform's approvals don't carry over.

**Webhooks for own numbers.** Delivery ticks and STOP/START replies for the owner's number go to the webhook of the owner's Meta app. To receive them:

- In the owner's app, set the callback URL to the same `${appUrl}/api/webhooks/whatsapp`, set the verify token to the same `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (the operator shares it with the client), and subscribe to `messages`.
- Paste that app's **App secret** into the StayFlow connection form. A payload is accepted when its signature matches either the platform secret or the secret saved for the phone number it names. A payload signed with an org's own secret can only update that organization's messages and residents.

If the owner skips this, sending still works. The outbox just stays at "Sent ✓", without delivered or read ticks, and STOP replies to their number aren't recorded automatically. In that case, set the resident's opt-out by hand.

## 3. Templates to submit

All templates use language `en` (English), and every one has a body only. The source of truth is `src/server/integrations/whatsapp-templates.ts`, and the same list appears on *Settings → WhatsApp*. If you approve a template under a different language code (for example `en_US`), change its `language` in the registry to match.

| Name | Category | Variables |
| --- | --- | --- |
| `rent_reminder_upcoming` | UTILITY | 1 name, 2 amount, 3 due date, 4 PG name, 5 room / bed |
| `rent_reminder_due_today` | UTILITY | same as above |
| `rent_reminder_overdue` | UTILITY | same as above (2 = balance) |
| `payment_receipt` | UTILITY | 1 name, 2 amount, 3 receipt number |
| `complaint_update` | UTILITY | 1 name, 2 complaint code, 3 complaint title |
| `announcement` | UTILITY | 1 name, 2 title, 3 announcement text |
| `welcome_resident` | UTILITY | 1 name, 2 PG name, 3 room / bed |
| `checkout_settlement` | UTILITY | 1 name, 2 refund amount |
| `account_invite` | UTILITY | 1 name, 2 organization name, 3 invite link |
| `password_reset` | UTILITY | 1 name, 2 reset link |

Body texts (copy exactly):

**rent_reminder_upcoming**
> Hi {{1}}, this is a friendly reminder that your rent of {{2}} is due on {{3}} for {{4}} (room {{5}}). You can pay from the StayFlow resident app. Please ignore this message if you have already paid.

**rent_reminder_due_today**
> Hi {{1}}, your rent of {{2}} is due today, {{3}}, for {{4}} (room {{5}}). You can pay from the StayFlow resident app. Please ignore this message if you have already paid.

**rent_reminder_overdue**
> Hi {{1}}, your rent of {{2}} was due on {{3}} for {{4}} (room {{5}}) and is still pending. Please pay at the earliest from the StayFlow resident app to avoid late fees. Ignore this message if you have already paid.

**payment_receipt**
> Hi {{1}}, we have received your payment of {{2}}. Your receipt number is {{3}}. You can download the receipt from the StayFlow resident app. Thank you!

**complaint_update**
> Hi {{1}}, your complaint {{2}} ({{3}}) has been marked as resolved. If the issue is still there, you can reopen it from the StayFlow resident app.

**announcement**
> Hi {{1}}, there is a new notice from your PG. {{2}}: {{3}} — You can see all notices in the StayFlow resident app.

**welcome_resident**
> Hi {{1}}, welcome to {{2}}! Your room / bed is {{3}}. You can pay rent, raise complaints and see the food menu from the StayFlow resident app.

**checkout_settlement**
> Hi {{1}}, your checkout is complete. Deposit refund due to you: {{2}}. Any balance still payable is shown in the StayFlow resident app. Thank you for staying with us.

**account_invite**
> Hi {{1}}, you have been invited to join {{2}} on StayFlow. Set up your account here: {{3}} — this link expires soon.

**password_reset**
> Hi {{1}}, use this link to reset your StayFlow password: {{2}} — it expires soon. If you did not ask for this, ignore this message.

Notes:
- Meta asks for a sample value for each variable when you submit a template. Use realistic ones, such as `Ravi`, `₹8,500`, `5 November`, `Sunrise PG`, `101 · Bed A`.
- `account_invite` and `password_reset` are account-access messages, so StayFlow sends them even to someone who replied STOP. Submit them as **UTILITY**. Meta's AUTHENTICATION category only allows its fixed one-time-code layout and doesn't accept links.
- `announcement` carries free text as `{{3}}`. Keep announcements operational (water cut, maintenance, rules). If they're used for offers, Meta may re-categorise the template as MARKETING, which costs more and is easier for users to block.

## 4. How sending behaves

- **Validation.** The number of variables must match the registry. If it doesn't, the message is stored as `FAILED` with the reason `Not sent: …` and Meta isn't called. Variables are cleaned up first: line breaks become ` · `, tabs and runs of spaces collapse, empty values become `-`, and the filled-in body is cut down to fit within 1024 characters.
- **Opt-out.** If a resident sends *STOP* or *UNSUBSCRIBE*, `whatsappOptOutAt` is set. Their later messages are stored as `FAILED – Recipient opted out` and aren't sent, except the account-access templates. Sending *START* clears the opt-out and records consent.
- **Status ticks.** The webhook moves a message from Sent ✓ to Delivered ✓✓ to Read (blue ✓✓). A status never moves backwards, and a failure shows Meta's reason.
- **Retries.** Variables and the attempt count are stored on every message. The daily automation retries `FAILED` messages that are under 3 days old, have fewer than 3 attempts and were last tried more than 30 minutes ago, 25 per run. It doesn't retry opt-outs, validation failures, or Meta's permanent rejections (prefixed `Rejected by WhatsApp:`). Owners and managers can also press **Retry** on a single failed message in the outbox.

## 5. Costs (India, indicative — check Meta's current rate card)

Meta bills per message or conversation, by category, to the WABA that sends:

- **Utility** (every StayFlow template): roughly ₹0.12–0.15 per message. It's free when the resident has messaged the number in the last 24 hours.
- **Authentication:** roughly ₹0.12. **Marketing:** roughly ₹0.80+.
- On the **platform number**, StayFlow pays and should build the cost into plan pricing. A reminder cycle of 3 messages for 100 residents works out to about ₹40–50 a month.
- On an **own number**, the PG owner pays Meta directly through the payment method on their own WABA.
