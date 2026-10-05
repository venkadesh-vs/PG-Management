import type { Metadata } from 'next'
import { publicEnv } from '@/lib/public-env'
import { SiteFooter, SiteHeader } from '@/components/marketing/site-chrome'

export const metadata: Metadata = {
  title: 'Privacy',
  description: `How ${publicEnv.appName} handles the information PG owners and their residents put into the product.`,
}

const SECTIONS = [
  {
    title: 'What we collect',
    body: [
      'When you enquire through this website we store your name, phone number, email, city and what you tell us about your PG. We use it to contact you about a demo and nothing else.',
      'When you use the product, the data you enter — residents, rooms, rent, payments, complaints, staff and expenses — is stored so the product can work. It belongs to you.',
    ],
  },
  {
    title: 'Resident information',
    body: [
      'PG owners enter resident details including name, contact number, guardian contact and ID reference. This is used to run the PG: allocating a bed, raising rent, sending reminders and handling complaints.',
      'ID numbers are shown masked in lists and receipts. Residents can see their own record in the resident app.',
    ],
  },
  {
    title: 'Who can see what',
    body: [
      'Each organization is isolated. A PG owner can only ever see their own PGs, residents and records — this is enforced on the server for every request, not just hidden in the interface.',
      'Within an organization, managers run day-to-day operations, workers see only the tasks assigned to them, and residents see only their own record.',
    ],
  },
  {
    title: 'Messages',
    body: [
      'Rent reminders, receipts and announcements are sent to the number a PG owner records for each resident. Where a WhatsApp Business account is connected, delivery is handled by WhatsApp under their terms.',
      'Where no WhatsApp account is connected, messages are stored in the product and clearly marked as not sent. Nothing is delivered without a connected account.',
    ],
  },
  {
    title: 'Payments',
    body: [
      'Where a payment gateway is connected, card and bank details are handled by the gateway. They never reach our servers or our database.',
      'We store the amount, the reference the gateway gives us, and which invoice it settled.',
    ],
  },
  {
    title: 'Analytics',
    body: [
      'Analytics are optional and off unless configured. When enabled we use a privacy-friendly provider that does not use cookies to follow you between websites.',
    ],
  },
  {
    title: 'Keeping it safe',
    body: [
      'Passwords are hashed and never stored in a readable form. Sessions are signed and can be revoked immediately. Every change in the product is recorded in an activity log with who made it.',
    ],
  },
  {
    title: 'Your choices',
    body: [
      'You can ask us to delete your enquiry at any time. If you are a customer, you can export or delete your organization\'s data.',
      `Write to ${publicEnv.contactEmail} and we will action it.`,
    ],
  },
]

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-white">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-32 sm:px-6">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Privacy</h1>
        <p className="mt-3 text-lg text-slate-600">
          Plain English, because a PG owner should not need a lawyer to understand what happens to
          their residents&apos; details.
        </p>

        <div className="mt-12 space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="font-display text-xl font-semibold tracking-tight text-slate-900">
                {section.title}
              </h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="mt-3 leading-relaxed text-slate-600">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <p className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
          Questions about any of this? Email{' '}
          <a href={`mailto:${publicEnv.contactEmail}`} className="font-medium text-blue-600">
            {publicEnv.contactEmail}
          </a>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}
