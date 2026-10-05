'use client'

import * as React from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, MessageCircle, Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { publicEnv, whatsappLink } from '@/lib/public-env'
import { Logo } from './logo'
import { Button } from '@/components/ui/button'

const NAV = [
  { label: 'How it works', href: '#how' },
  { label: 'Features', href: '#features' },
  { label: 'For residents', href: '#residents' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

const WHATSAPP_MESSAGE =
  "Hi, I manage a PG and I'm interested in seeing a demo of your PG management software."

/**
 * Marketing header. Turns solid once the visitor scrolls past the hero so the
 * nav never sits invisibly on a light section.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const wa = whatsappLink(WHATSAPP_MESSAGE)

  React.useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 24)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-50 transition-all duration-300',
          scrolled ? 'border-b border-slate-200 bg-white/85 backdrop-blur-lg' : 'bg-transparent',
        )}
      >
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo />

          <nav className="hidden flex-1 items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/login"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:block"
            >
              Sign in
            </Link>
            <Button variant="primary" size="sm" asChild className="hidden sm:inline-flex">
              <a href="/signup">
                Start free trial
                <ArrowRight className="size-3.5" />
              </a>
            </Button>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-slate-200 bg-white lg:hidden"
            >
              <nav className="space-y-1 px-4 py-4">
                {NAV.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {item.label}
                  </a>
                ))}
                <Link
                  href="/login"
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Sign in
                </Link>
                <div className="flex gap-2 pt-2">
                  <Button variant="primary" className="flex-1" asChild>
                    <a href="/signup" onClick={() => setOpen(false)}>
                      Start free trial
                    </a>
                  </Button>
                  {wa && (
                    <Button variant="outline" asChild>
                      <a href={wa} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="size-4" />
                      </a>
                    </Button>
                  )}
                </div>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Sticky mobile CTA — the primary conversion path on a phone. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 pb-safe backdrop-blur-lg sm:hidden">
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" asChild>
            <a href="/signup">Start free trial</a>
          </Button>
          {wa && (
            <Button variant="outline" asChild>
              <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp">
                <MessageCircle className="size-4" />
              </a>
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

export function SiteFooter() {
  const wa = whatsappLink(WHATSAPP_MESSAGE)
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-slate-200 bg-slate-50/70 pb-24 pt-14 sm:pb-14">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <Logo />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-600">
              An automated operating system for PGs. Residents, rooms, rent, complaints, food and
              staff in one place.
            </p>
          </div>

          <FooterColumn
            title="Product"
            links={[
              { label: 'How it works', href: '#how' },
              { label: 'Features', href: '#features' },
              { label: 'Resident app', href: '#residents' },
              { label: 'Reports', href: '#reports' },
              { label: 'Pricing', href: '#pricing' },
            ]}
          />
          <FooterColumn
            title="For PG owners"
            links={[
              { label: 'Book a free demo', href: '#demo' },
              { label: 'Calculate my price', href: '#pricing' },
              { label: 'Common questions', href: '#faq' },
              { label: 'Sign in', href: '/login' },
            ]}
          />

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Contact</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a
                  href={`mailto:${publicEnv.contactEmail}`}
                  className="text-slate-600 hover:text-slate-900"
                >
                  {publicEnv.contactEmail}
                </a>
              </li>
              {publicEnv.contactPhone && (
                <li>
                  <a
                    href={`tel:${publicEnv.contactPhone}`}
                    className="text-slate-600 hover:text-slate-900"
                  >
                    {publicEnv.contactPhone}
                  </a>
                </li>
              )}
              {wa && (
                <li>
                  <a
                    href={wa}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:text-emerald-800"
                  >
                    <MessageCircle className="size-3.5" />
                    Talk to us on WhatsApp
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            © {year} {publicEnv.appName}. Built around real PG workflows.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
            {[
              ['/terms', 'Terms'],
              ['/privacy', 'Privacy'],
              ['/refund-policy', 'Refunds & cancellation'],
              ['/shipping-policy', 'Delivery'],
              ['/contact', 'Contact'],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="hover:text-slate-800">
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({
  title,
  links,
}: {
  title: string
  links: { label: string; href: string }[]
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map((link) => (
          <li key={link.href + link.label}>
            {link.href.startsWith('#') ? (
              <a href={link.href} className="text-slate-600 hover:text-slate-900">
                {link.label}
              </a>
            ) : (
              <Link href={link.href} className="text-slate-600 hover:text-slate-900">
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Small WhatsApp CTA reused across sections. */
export function WhatsAppCta({ className }: { className?: string }) {
  const wa = whatsappLink(WHATSAPP_MESSAGE)
  if (!wa) return null
  return (
    <Button variant="outline" size="lg" asChild className={className}>
      <a href={wa} target="_blank" rel="noopener noreferrer">
        <MessageCircle className="size-4 text-emerald-600" />
        Talk to us on WhatsApp
      </a>
    </Button>
  )
}
