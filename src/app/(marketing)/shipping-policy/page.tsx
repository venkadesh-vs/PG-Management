import type { Metadata } from 'next'
import { publicEnv } from '@/lib/public-env'
import { contactLine, LegalPage, type LegalSection } from '@/components/marketing/legal-page'

export const metadata: Metadata = {
  title: 'Shipping & Delivery Policy',
  description: `How ${publicEnv.appName} is delivered.`,
}

const APP = publicEnv.appName

const SECTIONS: LegalSection[] = [
  {
    title: 'Digital service — nothing is shipped',
    body: [
      `${APP} is online software. We do not sell or ship physical goods, so there are no shipping charges or delivery times.`,
    ],
  },
  {
    title: 'When you get access',
    body: [
      'Your account is active immediately after you sign up, and paid features continue without interruption as soon as a payment succeeds.',
      'Login links for your managers, staff and residents are delivered by WhatsApp or email within a few minutes of being sent. Invoices and receipts are available in the app straight away.',
    ],
  },
  {
    title: 'If something does not arrive',
    body: [
      `If you paid but your access did not update, or a login link did not arrive, contact us and we will resolve it within one working day: ${contactLine()}.`,
    ],
  },
]

export default function ShippingPolicyPage() {
  return (
    <LegalPage
      title="Shipping & Delivery Policy"
      intro="How and when you receive the service you pay for."
      updated="5 October 2026"
      sections={SECTIONS}
    />
  )
}
