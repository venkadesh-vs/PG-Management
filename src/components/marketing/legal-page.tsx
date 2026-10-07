import Link from 'next/link'
import { publicEnv } from '@/lib/public-env'
import { SiteFooter, SiteHeader } from '@/components/marketing/site-chrome'

export type LegalSection = { title: string; body: string[] }

/** The legal entity, falling back to the product name until it is configured. */
export const LEGAL_ENTITY = publicEnv.legalName || publicEnv.appName

export const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refund-policy', label: 'Refund & Cancellation' },
  { href: '/shipping-policy', label: 'Shipping & Delivery' },
  { href: '/contact', label: 'Contact us' },
]

/**
 * Shared frame for the policy pages: title, last-updated date, numbered
 * sections, and links to the sibling policies.
 */
export function LegalPage({
  title,
  intro,
  updated,
  sections,
  children,
}: {
  title: string
  intro: string
  updated: string
  sections: LegalSection[]
  children?: React.ReactNode
}) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-white">
      <div className="mesh-blue pointer-events-none absolute inset-x-0 top-0 h-80 opacity-60" aria-hidden />
      <SiteHeader />
      <main id="main" className="relative mx-auto w-full max-w-3xl px-4 pb-20 pt-28 sm:px-6 sm:pt-32">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-900 text-balance sm:text-4xl">{title}</h1>
        <p className="mt-3 text-base text-slate-600 sm:text-lg">{intro}</p>
        <p className="mt-2 text-sm text-slate-400">Last updated: {updated}</p>

        <div className="mt-10 space-y-9">
          {sections.map((section, i) => (
            <section key={section.title}>
              <h2 className="font-display text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                {i + 1}. {section.title}
              </h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="mt-3 leading-relaxed text-slate-600">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
          {children}
        </div>

        <nav className="mt-14 border-t border-slate-200 pt-6" aria-label="Policies">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="rounded-md text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <SiteFooter />
    </div>
  )
}

/** Contact block reused by several policies. */
export function contactLine() {
  const parts = [`email ${publicEnv.contactEmail}`]
  if (publicEnv.contactPhone) parts.push(`call ${publicEnv.contactPhone}`)
  if (publicEnv.businessAddress) parts.push(`write to ${LEGAL_ENTITY}, ${publicEnv.businessAddress}`)
  return parts.join(', or ')
}
