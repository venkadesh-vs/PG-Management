import type { Metadata } from 'next'
import { publicEnv } from '@/lib/public-env'
import { contactLine, LEGAL_ENTITY, LegalPage, type LegalSection } from '@/components/marketing/legal-page'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `The terms on which PG owners and their teams use ${publicEnv.appName}.`,
}

const APP = publicEnv.appName
const COURTS = publicEnv.jurisdictionCity || 'the city of our registered office'

const SECTIONS: LegalSection[] = [
  {
    title: 'Who we are',
    body: [
      `${APP} is a software service operated by ${LEGAL_ENTITY}${publicEnv.businessAddress ? `, ${publicEnv.businessAddress}` : ''} ("we", "us"). These terms are an agreement between us and the business that creates a ${APP} account ("you"), and apply to everyone you invite to use it.`,
      'By creating an account or using the service you accept these terms. If you accept them on behalf of a business, you confirm you are authorised to do so.',
    ],
  },
  {
    title: 'The service',
    body: [
      `${APP} is software for running paying-guest accommodation: residents, rooms and beds, rent and receipts, complaints, food, staff, expenses, reminders and reports.`,
      'We provide the software only. You remain responsible for operating your PG, the rent and charges you set, your agreements with residents, police and local-authority registrations, and every legal obligation of your business.',
    ],
  },
  {
    title: 'Accounts and access',
    body: [
      'Keep your login details secret. You are responsible for what happens under your account and for the access you give managers, staff and residents.',
      'Tell us immediately if you suspect unauthorised access. We may suspend access to protect the service, your data or other customers.',
    ],
  },
  {
    title: 'Free trial, subscription and billing',
    body: [
      'New accounts start with a free trial. After it ends, each PG property is billed monthly according to the plan rules shown to you before the property is added. Prices are in Indian Rupees and exclusive of applicable GST, which is added to your invoice.',
      'With AutoPay (UPI AutoPay, card or e-mandate) the amount is collected automatically on the billing date. Otherwise an invoice is raised for you to pay online.',
      'If a payment fails or an invoice is unpaid, a grace period applies. After it, the account is restricted: you can still sign in and pay, but cannot make changes, and your residents and staff see a paused screen. Access returns as soon as the invoice is paid. Your data is not deleted for non-payment.',
      'Refunds and cancellation are governed by our Refund & Cancellation Policy.',
    ],
  },
  {
    title: 'Your data',
    body: [
      'The data you and your team enter belongs to you. You appoint us to process it only to provide the service, as described in our Privacy Policy. We do not sell it and never use one customer\'s data for another.',
      'You confirm that you have a lawful basis — including any notice and consent required under the Digital Personal Data Protection Act, 2023 — to enter your residents\' and staff\'s personal data, and that you will only collect what you need.',
      'You can export your data at any time while your account is active, and ask us to delete it when you leave.',
    ],
  },
  {
    title: 'Payments collected from your residents',
    body: [
      `When you connect your own payment gateway account, rent paid online goes directly to that account. ${APP} is not a party to the payment, does not hold the money, and is not responsible for refunds, chargebacks or disputes between you and your residents, which you handle under your gateway's terms.`,
    ],
  },
  {
    title: 'WhatsApp and other messages',
    body: [
      'Messages are sent through the WhatsApp Business Platform and are subject to Meta\'s terms and template approval. Send only messages your residents and staff have agreed to receive; opt-outs (replying STOP) are honoured automatically.',
    ],
  },
  {
    title: 'Acceptable use',
    body: [
      'Do not use the service to break any law, to send unsolicited or misleading messages, to store data you have no right to hold, to probe or disrupt the service, or to access another customer\'s data.',
    ],
  },
  {
    title: 'Availability and support',
    body: [
      'We work to keep the service available and secure, and to announce planned maintenance in advance, but we do not guarantee uninterrupted or error-free operation. Support is available through the channels on our Contact page.',
    ],
  },
  {
    title: 'Limitation of liability',
    body: [
      'To the extent permitted by law, the service is provided "as is", and we are not liable for indirect, incidental or consequential losses, including lost rent, profit or data arising from your use of it.',
      'Our total liability for any claim relating to the service is limited to the subscription fees you paid us in the three months before the claim arose.',
    ],
  },
  {
    title: 'Ending the agreement',
    body: [
      'You may cancel at any time from your subscription page or by contacting us. We may end or suspend the service for a serious breach of these terms, with notice where possible.',
      'After cancellation you can request an export of your data for 30 days, after which it is deleted except where the law requires us to keep records.',
    ],
  },
  {
    title: 'Changes, governing law and disputes',
    body: [
      'If we change these terms materially we will tell you at least 15 days before the change takes effect.',
      `These terms are governed by the laws of India. Disputes are subject to the exclusive jurisdiction of the courts at ${COURTS}.`,
      `Questions about these terms: ${contactLine()}.`,
    ],
  },
]

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="What you can expect from us, and what we ask of you."
      updated="5 October 2026"
      sections={SECTIONS}
    />
  )
}
