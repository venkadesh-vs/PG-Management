# WhatsApp in production

Status: **not configured.** Until the variables below exist, StayFlow stores every WhatsApp message
in the Message centre marked "Demo mode: nothing was sent". Nothing reaches residents.

Full setup steps: `docs/whatsapp-setup.md`. This file tracks the production state.

## Code behaviour (verified on production builds)

- Sends only Meta-approved templates; variables are filled per message type.
- Per-type on/off switches (Settings → Notifications); STOP replies opt a resident out.
- Failed sends are retried by the daily automation; manual retry needs send permission.
- Monthly quota per plan (`whatsappMonthlyLimit`): over the limit, messages are stored as "not sent
  (plan limit)" and the business action still succeeds.
- Webhook signature (`x-hub-signature-256`) checked in constant time.

## Owner checklist

| Step | Status |
| --- | --- |
| Meta Business account verified | [ ] |
| WhatsApp Business number added (not used on the WhatsApp app) | [ ] |
| Templates submitted and approved (names in `src/server/integrations/whatsapp-templates.ts`) | [ ] |
| Permanent system-user access token created | [ ] |
| Netlify variables set: `WHATSAPP_PROVIDER=meta`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | [ ] |
| Webhook `https://<site>/api/webhooks/whatsapp` verified in Meta, field `messages` subscribed | [ ] |
| Test send to **your own** number from Settings → WhatsApp → Send test message | [ ] |

Never test with real residents' numbers. The first real resident message happens only after the
test send above is delivered and you approve.
