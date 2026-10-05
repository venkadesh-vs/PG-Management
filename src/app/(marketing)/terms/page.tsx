import type { Metadata } from 'next'
import { publicEnv } from '@/lib/public-env'
import { SiteFooter, SiteHeader } from '@/components/marketing/site-chrome'

export const metadata: Metadata = {
  title: 'Terms',
  description: `The terms on which PG owners use ${publicEnv.appName}.`,
}

const SECTIONS = [
  {
    title: 'The service',
    body: [
      `${publicEnv.appName} is software for running a paying guest accommodation: residents, rooms and beds, rent, complaints, food, staff and expenses.`,
      'We provide the software. You remain responsible for running your PG, for what you charge, and for your obligations to your residents and your local authorities.',
    ],
  },
  {
    title: 'Your account',
    body: [
      'You are responsible for keeping your login details safe and for what the people you invite — managers, workers and residents — do with their access.',
      'Tell us straight away if you think someone has your password.',
    ],
  },
  {
    title: 'Subscription and billing',
    body: [
      'Subscriptions are charged per PG property. The amount is derived from the plan rules in force when the PG is added, and is shown to you before you create it.',
      'Billing is monthly. Where AutoPay is set up, the amount is collected on the billing date. Where it is not, an invoice is raised for you to settle.',
      'If a payment fails you get a grace period before the account is restricted. Your data is never deleted for non-payment — it stays until you ask us to remove it.',
      'You can cancel at any time. We do not charge a cancellation fee.',
    ],
  },
  {
    title: 'Your data',
    body: [
      'The data you enter is yours. We do not sell it, and we do not use one customer\'s data to serve another.',
      'You can export it or ask for it to be deleted at any time.',
    ],
  },
  {
    title: 'Messages and payments',
    body: [
      'WhatsApp delivery requires your own WhatsApp Business account and is subject to WhatsApp\'s terms and template approval. Online payment collection requires your own payment gateway account.',
      'Until those are connected, the product clearly shows what would be sent or charged rather than doing it.',
    ],
  },
  {
    title: 'Availability',
    body: [
      'We work to keep the service running, but we do not promise it will never be unavailable. Scheduled maintenance is announced in advance where we can.',
    ],
  },
  {
    title: 'Fair use',
    body: [
      'Do not use the product to send messages people have not agreed to receive, to store data you have no right to hold, or to break any law that applies to you.',
    ],
  },
  {
    title: 'Changes',
    body: [
      'If we change these terms materially we will tell you before the change takes effect, so you can decide whether to continue.',
    ],
  },
]

export default function TermsPage() {
  return (
    <div className="min-h-dvh bg-white">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-32 sm:px-6">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Terms</h1>
        <p className="mt-3 text-lg text-slate-600">
          What you can expect from us, and what we ask of you.
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
          Anything unclear? Email{' '}
          <a href={`mailto:${publicEnv.contactEmail}`} className="font-medium text-blue-600">
            {publicEnv.contactEmail}
          </a>{' '}
          and we will explain it properly.
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}
