'use client'

import * as React from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { ArrowRight, Check, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Reveal } from '@/components/motion/reveal'

/**
 * Building blocks shared by every marketing section: headings, product
 * frames, status pills and the problem → solution → visual → benefits → CTA
 * section shell. Visuals are JSX mock-ups of real StayFlow screens, so they
 * are always decorative (aria-hidden) and the copy beside them carries the
 * meaning.
 */

export function Eyebrow({ icon: Icon, children, dark }: { icon?: LucideIcon; children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-wide',
        dark
          ? 'border border-white/15 bg-white/[0.06] text-blue-200'
          : 'border border-blue-200/80 bg-blue-50/80 text-blue-700',
      )}
    >
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
  dark,
  icon,
  as: Tag = 'h2',
}: {
  eyebrow?: string
  title: React.ReactNode
  description?: React.ReactNode
  align?: 'center' | 'left'
  dark?: boolean
  icon?: LucideIcon
  as?: 'h2' | 'h3'
}) {
  return (
    <Reveal className={cn('max-w-3xl', align === 'center' ? 'mx-auto text-center' : 'text-left')}>
      {eyebrow && (
        <Eyebrow icon={icon} dark={dark}>
          {eyebrow}
        </Eyebrow>
      )}
      <Tag
        className={cn(
          'mt-4 font-display text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl lg:text-[2.75rem]',
          dark ? 'text-white' : 'text-slate-900',
        )}
      >
        {title}
      </Tag>
      {description && (
        <p
          className={cn(
            'mt-4 text-base leading-relaxed text-pretty sm:text-lg',
            dark ? 'text-white/65' : 'text-slate-600',
            align === 'center' && 'mx-auto max-w-2xl',
          )}
        >
          {description}
        </p>
      )}
    </Reveal>
  )
}

// ------------------------------------------------------------- Frames ----

/** A desktop app window around a mock StayFlow screen. */
export function BrowserFrame({
  title,
  children,
  className,
  dark,
}: {
  title?: string
  children: React.ReactNode
  className?: string
  dark?: boolean
}) {
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-2xl border shadow-float',
        dark ? 'border-white/10 bg-slate-900' : 'border-slate-200/80 bg-white',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 border-b px-3 py-2.5',
          dark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-100 bg-slate-50/80',
        )}
      >
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-red-300" />
          <span className="size-2.5 rounded-full bg-amber-300" />
          <span className="size-2.5 rounded-full bg-emerald-300" />
        </span>
        {title && (
          <span
            className={cn(
              'mx-auto truncate rounded-md px-3 py-0.5 font-mono text-[10px]',
              dark ? 'bg-white/5 text-white/50' : 'bg-white text-slate-400 ring-1 ring-slate-200/70',
            )}
          >
            {title}
          </span>
        )}
        <span className="w-[42px]" />
      </div>
      {children}
    </div>
  )
}

/** A phone around a mock resident / worker screen. */
export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative mx-auto w-[248px] max-w-full shrink-0 rounded-[2.4rem] border-[7px] border-slate-900 bg-slate-900 shadow-float',
        className,
      )}
    >
      <div className="absolute left-1/2 top-1.5 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-slate-900" />
      <div className="relative overflow-hidden rounded-[1.9rem] bg-slate-50">{children}</div>
    </div>
  )
}

// -------------------------------------------------------------- Pills ----

export type Tone = 'green' | 'blue' | 'indigo' | 'amber' | 'red' | 'neutral' | 'dark'

const TONES: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  indigo: 'bg-violet-50 text-violet-700 ring-violet-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  dark: 'bg-slate-800 text-white ring-slate-700',
}

const DOTS: Record<Tone, string> = {
  green: 'bg-emerald-500',
  blue: 'bg-sky-500',
  indigo: 'bg-violet-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  neutral: 'bg-slate-400',
  dark: 'bg-white',
}

export function Pill({ tone, children, className, dot = true }: { tone: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  )
}

/** Bed status → semantic colour, shared by every bed visual on the site. */
export type BedState = 'available' | 'reserved' | 'occupied' | 'maintenance' | 'blocked'

export const BED_STYLES: Record<BedState, { label: string; tile: string; tone: Tone }> = {
  available: { label: 'Available', tile: 'border-emerald-200 bg-emerald-50 text-emerald-700', tone: 'green' },
  reserved: { label: 'Reserved', tile: 'border-sky-200 bg-sky-50 text-sky-700', tone: 'blue' },
  occupied: { label: 'Occupied', tile: 'border-violet-200 bg-violet-100/70 text-violet-700', tone: 'indigo' },
  maintenance: { label: 'Maintenance', tile: 'border-amber-200 bg-amber-50 text-amber-700', tone: 'amber' },
  blocked: { label: 'Blocked', tile: 'border-slate-700 bg-slate-700 text-white', tone: 'dark' },
}

// --------------------------------------------------------------- Tilt ----

/**
 * Follows the pointer with a subtle 3D tilt. Does nothing for reduced-motion
 * users or touch screens (no hover), where it renders a plain wrapper.
 */
export function Tilt({ children, className, max = 6 }: { children: React.ReactNode; className?: string; max?: number }) {
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rx = useSpring(useTransform(y, [-0.5, 0.5], [max, -max]), { stiffness: 150, damping: 18 })
  const ry = useSpring(useTransform(x, [-0.5, 0.5], [-max, max]), { stiffness: 150, damping: 18 })

  if (reduce) return <div className={className}>{children}</div>

  function onMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return
    const rect = event.currentTarget.getBoundingClientRect()
    x.set((event.clientX - rect.left) / rect.width - 0.5)
    y.set((event.clientY - rect.top) / rect.height - 0.5)
  }

  return (
    <div className={cn('[perspective:1400px]', className)} onPointerMove={onMove} onPointerLeave={() => { x.set(0); y.set(0) }}>
      <motion.div style={{ rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d' }}>{children}</motion.div>
    </div>
  )
}

// ----------------------------------------------------- Feature section ----

export type FeatureSectionProps = {
  id: string
  eyebrow: string
  icon: LucideIcon
  title: React.ReactNode
  problem: string
  solution: string
  benefits: string[]
  visual: React.ReactNode
  reverse?: boolean
  cta?: { label: string; href: string }
  className?: string
  /** Optional note under the benefits (e.g. "coming soon"). */
  note?: React.ReactNode
}

/**
 * The repeated product section: the problem an owner recognises, how StayFlow
 * solves it, a product visual, the benefits, and a call to action.
 */
export function FeatureSection({
  id,
  eyebrow,
  icon,
  title,
  problem,
  solution,
  benefits,
  visual,
  reverse,
  cta = { label: 'Start free', href: '/signup' },
  className,
  note,
}: FeatureSectionProps) {
  const headingId = `${id}-title`
  return (
    <section id={id} aria-labelledby={headingId} className={cn('relative scroll-mt-24 py-20 sm:py-28', className)}>
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
        <div className={cn('min-w-0', reverse && 'lg:order-2')}>
          <Reveal>
            <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
            <h2
              id={headingId}
              className="mt-4 font-display text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-4xl"
            >
              {title}
            </h2>
          </Reveal>

          <Reveal delay={0.08} className="mt-6 space-y-4">
            <p className="flex gap-3 text-[15px] leading-relaxed text-slate-500">
              <span className="mt-0.5 shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600">
                Today
              </span>
              <span className="min-w-0">{problem}</span>
            </p>
            <p className="flex gap-3 text-[15px] leading-relaxed text-slate-700">
              <span className="mt-0.5 shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
                StayFlow
              </span>
              <span className="min-w-0">{solution}</span>
            </p>
          </Reveal>

          <Reveal delay={0.14}>
            <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {benefits.map((benefit) => (
                <li key={benefit} className="flex min-w-0 items-start gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <Check className="size-2.5 text-emerald-700" strokeWidth={3.5} aria-hidden />
                  </span>
                  {benefit}
                </li>
              ))}
            </ul>
            {note && <div className="mt-5">{note}</div>}
            <Button variant="ghost" asChild className="-ml-3 mt-6 text-blue-700 hover:bg-blue-50 hover:text-blue-800">
              <a href={cta.href}>
                {cta.label}
                <ArrowRight className="group-hover/btn:translate-x-0.5" aria-hidden />
              </a>
            </Button>
          </Reveal>
        </div>

        <Reveal delay={0.1} y={24} className={cn('min-w-0', reverse && 'lg:order-1')}>
          <div aria-hidden className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-blue-100/70 via-violet-50/40 to-marigold-50/60 blur-2xl" />
            {visual}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/** Plays a looping list of states while the element is on screen. */
export function useCycle(length: number, interval: number, active: boolean) {
  const [index, setIndex] = React.useState(0)
  React.useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setIndex((i) => (i + 1) % length), interval)
    return () => window.clearInterval(id)
  }, [length, interval, active])
  return index
}
