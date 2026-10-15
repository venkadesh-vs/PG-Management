'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { BedDouble, IndianRupee, KeyRound, Lock, ShieldCheck, Sparkles, UtensilsCrossed, Zap } from 'lucide-react'

const EASE = [0.22, 1, 0.36, 1] as const

function useRise() {
  const reduce = useReducedMotion()
  return (delay: number) =>
    reduce
      ? {}
      : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, ease: EASE, delay } }
}

/** The promise above the PG illustration. */
export function SceneIntro() {
  const rise = useRise()
  return (
    <div className="text-center lg:text-left">
      <motion.span
        {...rise(0)}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/80 backdrop-blur"
      >
        <Sparkles className="size-3.5 text-marigold-300" />
        The operating system for PGs
      </motion.span>
      <motion.h1
        {...rise(0.08)}
        className="mt-4 font-display text-[2rem] font-semibold leading-[1.08] tracking-[-0.02em] text-white text-balance sm:text-[2.4rem]"
      >
        Every bed, every rupee,{' '}
        <span className="animate-gradient-x bg-gradient-to-r from-marigold-200 via-amber-50 to-marigold-300 bg-[length:200%_auto] bg-clip-text text-transparent">
          every evening.
        </span>
      </motion.h1>
      <motion.p {...rise(0.16)} className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/60 sm:text-base lg:mx-0">
        Your PG keeps running while you are away. Sign in to see who paid, who moved in and what needs you.
      </motion.p>
    </div>
  )
}

const TILES = [
  { icon: BedDouble, label: 'Beds' },
  { icon: IndianRupee, label: 'Rent' },
  { icon: UtensilsCrossed, label: 'Food' },
  { icon: Zap, label: 'Electricity' },
]

/** Four large gold icons: what lives behind the sign-in. Laptop only. */
export function FeatureTiles() {
  const reduce = useReducedMotion()
  return (
    <ul className="mx-auto mt-6 hidden w-full max-w-xl grid-cols-4 gap-3 lg:grid">
      {TILES.map((t, i) => (
        <motion.li
          key={t.label}
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.5 + i * 0.08 }}
          whileHover={reduce ? undefined : { y: -4 }}
          className="group flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] px-2 py-3 text-center"
        >
          <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-marigold-300/25 to-marigold-400/5 text-marigold-200 ring-1 ring-inset ring-marigold-300/30 transition-shadow group-hover:shadow-[0_0_30px_-6px_rgb(252_191_77/0.6)]">
            <t.icon className="size-6" />
          </span>
          <span className="text-xs font-medium text-white/70">{t.label}</span>
        </motion.li>
      ))}
    </ul>
  )
}

/** The floating card around the form, with a big key badge and trust notes. */
export function SignInCard({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.1 }}
      className="relative rounded-[1.75rem] bg-gradient-to-b from-white to-white/90 p-[1px] shadow-[0_30px_80px_-30px_rgb(27_25_24/0.45)]"
    >
      <div className="absolute inset-0 rounded-[1.75rem] bg-gradient-to-br from-blue-200 via-white to-marigold-200 opacity-80" aria-hidden />
      <div className="relative rounded-[calc(1.75rem-1px)] bg-white px-6 pb-7 pt-8 sm:px-8">
        <div className="flex flex-col items-center text-center">
          <span className="relative flex size-16 items-center justify-center">
            {!reduce && (
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-[1.25rem] bg-blue-500/20"
                animate={{ scale: [1, 1.35], opacity: [0.6, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
              />
            )}
            <span className="relative flex size-16 items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-ink-900 to-ink-950 text-marigold-200 shadow-[0_14px_30px_-12px_rgb(11_16_26/0.8)] ring-1 ring-white/10">
              <KeyRound className="size-7" />
            </span>
          </span>
          <h2 className="mt-5 font-display text-[1.75rem] font-semibold tracking-[-0.02em] text-slate-900">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to open your StayFlow dashboard.</p>
        </div>

        <div className="mt-7">{children}</div>

        <div className="mt-6 flex items-center justify-center gap-4 border-t border-slate-100 pt-5 text-[11px] font-medium text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" />
            Encrypted sign-in
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" />
            Role-based access
          </span>
        </div>
      </div>
    </motion.div>
  )
}
