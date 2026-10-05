import type { Metadata } from 'next'
import { Mail, MapPin, MessageCircle, Phone, ShieldCheck } from 'lucide-react'
import { publicEnv, whatsappLink } from '@/lib/public-env'
import { LEGAL_ENTITY, LegalPage } from '@/components/marketing/legal-page'

export const metadata: Metadata = {
  title: 'Contact us',
  description: `Reach the ${publicEnv.appName} team for sales, support, billing or privacy questions.`,
}

export default function ContactPage() {
  const wa = whatsappLink(`Hi, I have a question about ${publicEnv.appName}.`)
  const rows = [
    { icon: Mail, label: 'Email', value: publicEnv.contactEmail, href: `mailto:${publicEnv.contactEmail}` },
    publicEnv.contactPhone
      ? { icon: Phone, label: 'Phone', value: publicEnv.contactPhone, href: `tel:${publicEnv.contactPhone.replace(/\s/g, '')}` }
      : null,
    wa ? { icon: MessageCircle, label: 'WhatsApp', value: 'Chat with us', href: wa } : null,
    publicEnv.businessAddress
      ? { icon: MapPin, label: 'Registered office', value: `${LEGAL_ENTITY}, ${publicEnv.businessAddress}`, href: null }
      : null,
    {
      icon: ShieldCheck,
      label: 'Grievance Officer (privacy)',
      value: [publicEnv.grievanceOfficer, publicEnv.grievanceEmail || publicEnv.contactEmail].filter(Boolean).join(' · '),
      href: `mailto:${publicEnv.grievanceEmail || publicEnv.contactEmail}`,
    },
  ].filter((r): r is NonNullable<typeof r> => r !== null)

  return (
    <LegalPage
      title="Contact us"
      intro="Questions about the product, your account, billing or privacy — we reply within one working day."
      updated="5 October 2026"
      sections={[]}
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => {
          const Icon = row.icon
          const content = (
            <span className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">{row.label}</span>
                <span className="mt-0.5 block break-words text-sm font-medium text-slate-900">{row.value}</span>
              </span>
            </span>
          )
          return (
            <li key={row.label} className="rounded-2xl border border-slate-200 p-4">
              {row.href ? (
                <a href={row.href} className="block hover:opacity-80">
                  {content}
                </a>
              ) : (
                content
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-sm leading-relaxed text-slate-500">
        Support hours: Monday to Saturday, 10:00 to 19:00 IST. Residents with questions about rent,
        rooms or deposits should contact their PG owner directly.
      </p>
    </LegalPage>
  )
}
