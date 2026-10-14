import { Building2, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { Logo } from '@/components/marketing/logo'

const HIGHLIGHTS = [
  { icon: Zap, title: 'Rent runs itself', body: 'Invoices, WhatsApp reminders, UPI and AutoPay, on schedule.' },
  { icon: Building2, title: 'Every bed accounted for', body: 'Occupancy updates the moment someone checks in.' },
  { icon: ShieldCheck, title: 'The right view for everyone', body: 'Owners, staff and residents each see only their own.' },
]

/**
 * The dark ink-and-gold panel beside every account screen on a laptop,
 * matching the homepage hero. Hidden on phones so the form comes first.
 */
export function BrandPanel({
  title = 'Run your entire PG from one place.',
  body = 'Residents, rooms, rent, electricity, food and staff, connected, so entering something once updates everything attached to it.',
}: {
  title?: string
  body?: string
}) {
  return (
    <div className="grain relative hidden overflow-hidden bg-ink-950 lg:block">
      <div aria-hidden className="absolute -left-40 -top-40 size-[34rem] rounded-full bg-blue-600/30 blur-[120px]" />
      <div aria-hidden className="absolute -bottom-40 -right-24 size-[28rem] rounded-full bg-marigold-400/15 blur-[110px]" />
      <div aria-hidden className="dot-grid absolute inset-0 opacity-[0.08] invert [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <div aria-hidden className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-marigold-300/30 to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-12">
        <Logo variant="light" />

        <div className="max-w-md space-y-8">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
              <Sparkles className="size-3 text-marigold-300" />
              The operating system for PGs
            </span>
            <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-[-0.02em] text-white text-balance">
              {title}
            </h1>
            <p className="text-base leading-relaxed text-white/65">{body}</p>
          </div>

          <ul className="space-y-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex gap-3">
                <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02]">
                  <item.icon className="size-[18px] text-marigold-300" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="text-sm text-white/55">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/35">© {new Date().getFullYear()} StayFlow. Built around real PG workflows.</p>
      </div>
    </div>
  )
}
