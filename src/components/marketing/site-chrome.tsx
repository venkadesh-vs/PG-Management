'use client'

import * as React from 'react'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Mail, MessageCircle, Menu, Phone, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { publicEnv, whatsappLink } from '@/lib/public-env'
import { EASE_OUT } from '@/components/motion/reveal'
import { Button } from '@/components/ui/button'
import { Logo } from './logo'

// Absolute hash links so the header works on the legal pages too; on the
// homepage they are plain in-page jumps.
const NAV = [
  { label: 'How it works', href: '/#how' },
  { label: 'Features', href: '/#features' },
  { label: 'Resident app', href: '/#resident-app' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'FAQ', href: '/#faq' },
]

const WHATSAPP_MESSAGE = "Hi, I manage a PG and I'm interested in seeing a demo of StayFlow."

/**
 * Marketing header: transparent over the hero, frosted glass once the page
 * scrolls. On phones the menu opens full-screen with links cascading in.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const reduce = useReducedMotion()
  const wa = whatsappLink(WHATSAPP_MESSAGE)

  React.useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 16)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Lock page scroll and listen for Escape while the mobile menu is open.
  React.useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const solid = scrolled || open

  return (
    <>
      <a
        href="#main"
        className="sr-only z-[70] rounded-lg bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-lift focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <header
        className={cn(
          'fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300',
          solid
            ? 'border-b border-slate-200/70 bg-white/75 shadow-[0_8px_24px_-16px_rgb(27_25_24/0.25)] backdrop-blur-xl backdrop-saturate-150'
            : 'border-b border-transparent bg-transparent',
        )}
      >
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo />

          <nav aria-label="Main" className="hidden flex-1 items-center justify-center gap-1 lg:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-900/[0.04] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <Link
              href="/login"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 sm:block"
            >
              Sign in
            </Link>
            <Button variant="primary" size="sm" asChild className="hidden h-9 px-4 sm:inline-flex">
              <a href="/signup">
                Start free
                <ArrowRight className="size-3.5" aria-hidden />
              </a>
            </Button>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              aria-controls="mobile-menu"
              className="relative z-[60] rounded-xl p-2 text-slate-700 hover:bg-slate-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 lg:hidden"
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Full-screen mobile menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-40 flex flex-col overflow-y-auto overflow-x-hidden bg-white/95 px-6 pb-8 pt-24 backdrop-blur-xl lg:hidden"
          >
            <div className="aurora opacity-40" aria-hidden />
            <motion.nav
              aria-label="Mobile"
              className="relative flex flex-col"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.05, delayChildren: 0.05 } } }}
            >
              {[...NAV, { label: 'Sign in', href: '/login' }].map((item) => (
                <motion.a
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  variants={{
                    hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 18 },
                    show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
                  }}
                  className="border-b border-slate-200/70 py-4 font-display text-2xl font-bold tracking-tight text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                  {item.label}
                </motion.a>
              ))}
            </motion.nav>
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.45, ease: EASE_OUT }}
              className="relative mt-auto space-y-3 pt-8"
            >
              <Button variant="primary" size="xl" className="w-full" asChild>
                <a href="/signup" onClick={() => setOpen(false)}>
                  Start free
                  <ArrowRight aria-hidden />
                </a>
              </Button>
              <Button variant="outline" size="xl" className="w-full" asChild>
                <a href="/#demo" onClick={() => setOpen(false)}>
                  Book a demo
                </a>
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sticky phone CTA — the primary conversion path on a small screen. */}
      {!open && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/85 p-3 pb-safe backdrop-blur-xl sm:hidden">
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" asChild>
              <a href="/signup">Start free</a>
            </Button>
            <Button variant="outline" asChild className="flex-1">
              <a href="/#demo">Book a demo</a>
            </Button>
            {wa && (
              <Button variant="outline" size="icon" asChild>
                <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp">
                  <MessageCircle className="text-emerald-600" />
                </a>
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const PRODUCT_LINKS = [
  { label: 'How it works', href: '/#how' },
  { label: 'Bed management', href: '/#beds' },
  { label: 'Residents', href: '/#residents' },
  { label: 'Rent collection', href: '/#rent' },
  { label: 'Enquiries & bookings', href: '/#enquiries' },
  { label: 'Food & grocery', href: '/#food' },
  { label: 'Complaints', href: '/#complaints' },
  { label: 'Revenue intelligence', href: '/#reports' },
  { label: 'Resident app', href: '/#resident-app' },
]

const COMPANY_LINKS = [
  { label: 'Pricing', href: '/#pricing' },
  { label: 'Book a demo', href: '/#demo' },
  { label: 'FAQ', href: '/#faq' },
  { label: 'Start free', href: '/signup' },
  { label: 'Sign in', href: '/login' },
]

const LEGAL = [
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Refund & Cancellation', href: '/refund-policy' },
  { label: 'Shipping & Delivery', href: '/shipping-policy' },
  { label: 'Contact us', href: '/contact' },
]

export function SiteFooter() {
  const wa = whatsappLink(WHATSAPP_MESSAGE)
  const year = new Date().getFullYear()

  return (
    <footer className="relative overflow-hidden bg-slate-950 pb-28 pt-16 text-white sm:pb-14">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" aria-hidden />
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="min-w-0">
            <Logo variant="light" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">
              The operating system for PGs — beds, residents, rent, staff, food, complaints and profit in one place.
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              <li>
                <a href={`mailto:${publicEnv.contactEmail}`} className="inline-flex items-center gap-2 text-white/70 hover:text-white">
                  <Mail className="size-3.5" aria-hidden />
                  {publicEnv.contactEmail}
                </a>
              </li>
              {publicEnv.contactPhone && (
                <li>
                  <a href={`tel:${publicEnv.contactPhone}`} className="inline-flex items-center gap-2 text-white/70 hover:text-white">
                    <Phone className="size-3.5" aria-hidden />
                    {publicEnv.contactPhone}
                  </a>
                </li>
              )}
              {wa && (
                <li>
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-medium text-emerald-400 hover:text-emerald-300">
                    <MessageCircle className="size-3.5" aria-hidden />
                    Talk to us on WhatsApp
                  </a>
                </li>
              )}
            </ul>
          </div>

          <FooterColumn title="Product" links={PRODUCT_LINKS} />
          <FooterColumn title="Get started" links={COMPANY_LINKS} />
          <FooterColumn title="Legal" links={LEGAL} />
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {publicEnv.legalName || publicEnv.appName}. All rights reserved.
          </p>
          <p>Made for PG owners in India.</p>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <nav aria-label={title} className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-white/40">{title}</p>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map((link) => (
          <li key={link.href + link.label}>
            {link.href.startsWith('/#') ? (
              <a href={link.href} className="text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50">
                {link.label}
              </a>
            ) : (
              <Link href={link.href} className="text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50">
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
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
