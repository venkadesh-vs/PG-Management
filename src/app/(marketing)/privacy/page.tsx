import type { Metadata } from 'next'
import { publicEnv } from '@/lib/public-env'
import { contactLine, LEGAL_ENTITY, LegalPage, type LegalSection } from '@/components/marketing/legal-page'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${publicEnv.appName} collects, uses and protects personal data.`,
}

const APP = publicEnv.appName
const GRIEVANCE = publicEnv.grievanceOfficer
  ? `${publicEnv.grievanceOfficer} (${publicEnv.grievanceEmail || publicEnv.contactEmail})`
  : publicEnv.grievanceEmail || publicEnv.contactEmail

const SECTIONS: LegalSection[] = [
  {
    title: 'Who this covers and our role',
    body: [
      `This policy explains how ${LEGAL_ENTITY} handles personal data in ${APP}, in line with India's Digital Personal Data Protection Act, 2023 ("DPDP Act") and the Information Technology Act, 2000.`,
      'For PG owners and their team members who sign up with us, we decide how your account data is used. For residents, staff and visitors whose details a PG owner enters, the PG owner decides how that data is used and we process it on their behalf, only to run the service.',
    ],
  },
  {
    title: 'What we collect',
    body: [
      'Account data: name, email, phone number, business name and city, and a hashed (unreadable) password.',
      'Data entered by PG owners about residents and staff: name, contact numbers, guardian details, address, occupation, ID type and number, documents uploaded for verification, room and bed, rent, payments, deposits, complaints and visitor entries.',
      'Payment data: payment amounts, status and gateway reference numbers. Card, UPI and bank details are entered on the payment gateway\'s own page and never reach or are stored by us.',
      'Technical data: sign-in times, IP address and device type, used for security and to keep the service working.',
    ],
  },
  {
    title: 'Why we use it',
    body: [
      'To provide the service: managing rooms, residents, rent, receipts, reminders, complaints, food, staff and reports.',
      'To send service messages — rent reminders, receipts, complaint updates and login links — by WhatsApp, email or in the app.',
      'To bill our subscription, keep the service secure, prevent fraud and meet legal obligations such as tax records.',
      'We do not sell personal data, show advertising, or use residents\' data for any purpose of our own.',
    ],
  },
  {
    title: 'Consent and your choices',
    body: [
      'PG owners are responsible for informing residents and staff and obtaining any consent required before entering their data. Residents\' consent to WhatsApp messages is recorded at check-in.',
      'Anyone can stop WhatsApp messages by replying STOP, and start again by replying START. You can withdraw consent at any time; this does not affect processing that already happened.',
    ],
  },
  {
    title: 'Who we share it with',
    body: [
      'Only with service providers who help us run the service, under contract and only for that purpose: cloud hosting and database providers, Meta (WhatsApp Business Platform) for messages, our email provider, and Razorpay for payments.',
      'We disclose data to authorities only when required by law. We never share one customer\'s data with another.',
    ],
  },
  {
    title: 'Security',
    body: [
      'Data is encrypted in transit (HTTPS). Passwords are hashed, payment and messaging credentials are encrypted at rest, ID numbers are masked for everyone except the PG owner, and access is limited by role so residents see only their own records.',
      'If a personal-data breach occurs, we will notify the affected PG owners and the Data Protection Board of India as the DPDP Act requires.',
    ],
  },
  {
    title: 'How long we keep it',
    body: [
      'We keep data while the account is active. After an account is closed it is deleted within 30 days, except records we must keep by law (for example tax invoices, kept for 8 years).',
      'PG owners can delete a checked-out resident\'s personal data at any time, subject to their own legal record-keeping duties.',
    ],
  },
  {
    title: 'Your rights',
    body: [
      'You may ask to access, correct or erase your personal data, and to nominate someone to exercise these rights for you. Residents and staff should first contact their PG owner, who controls their data; we will help the owner respond.',
      `To exercise a right or raise a concern, contact our Grievance Officer: ${GRIEVANCE}. We reply within 30 days. If you are not satisfied, you may approach the Data Protection Board of India.`,
    ],
  },
  {
    title: 'Children',
    body: [
      'The service is for businesses. Where a resident is under 18, the PG owner must obtain verifiable consent from a parent or guardian before entering their data.',
    ],
  },
  {
    title: 'Changes and contact',
    body: [
      'We will post any change to this policy here and tell account holders about material changes in advance.',
      `Questions: ${contactLine()}.`,
    ],
  },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="What personal data we hold, why, and the rights everyone has over it."
      updated="5 October 2026"
      sections={SECTIONS}
    />
  )
}
