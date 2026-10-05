import type { Metadata } from 'next'
import { publicEnv } from '@/lib/public-env'
import { contactLine, LegalPage, type LegalSection } from '@/components/marketing/legal-page'

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy',
  description: `How cancellation and refunds work for ${publicEnv.appName} subscriptions.`,
}

const APP = publicEnv.appName

const SECTIONS: LegalSection[] = [
  {
    title: 'Free trial',
    body: [
      'Every new account starts with a free trial. Nothing is charged during the trial, and you can stop using the service at any time without paying.',
    ],
  },
  {
    title: 'Cancelling your subscription',
    body: [
      'You can cancel a PG\'s subscription, or your whole account, at any time from the subscription page or by contacting us. There is no cancellation fee.',
      'Cancellation takes effect at the end of the current billing month. You keep full access until then, and AutoPay mandates are cancelled so no further charges are made.',
    ],
  },
  {
    title: 'Refunds',
    body: [
      'Subscription fees are charged monthly in advance and are not refundable for a month that has already started, including partially used months.',
      'If you are charged twice, charged after cancelling, or charged an incorrect amount, we refund the excess in full. Approved refunds are issued to the original payment method within 5–7 working days; your bank may take a few more days to show it.',
      'To request a refund, contact us within 30 days of the charge with your invoice number.',
    ],
  },
  {
    title: 'Rent and payments made to PG owners',
    body: [
      `Rent, deposits and other charges that residents pay through ${APP} go directly to the PG owner's own payment account. ${APP} does not receive or hold that money, so refunds of rent or deposits — for example on checkout — are made by the PG owner under their own policy. Please contact your PG owner for these.`,
    ],
  },
  {
    title: 'Contact',
    body: [`For cancellations or refunds: ${contactLine()}.`],
  },
]

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund & Cancellation Policy"
      intro="Cancel any time. Here is exactly what happens to your billing when you do."
      updated="5 October 2026"
      sections={SECTIONS}
    />
  )
}
