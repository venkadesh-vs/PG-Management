'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { BedDouble, IndianRupee, UtensilsCrossed, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * An illustrated PG building at dusk: warm windows that switch on and off as
 * residents come and go, a moon, stars, and floating glass cards showing the
 * kind of thing StayFlow keeps track of. Purely decorative.
 */

const COLS = 6
const ROWS = 4
// Deterministic "random" so server and client render the same windows.
const seeded = (n: number) => {
  const x = Math.sin(n * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

const STARS = Array.from({ length: 22 }, (_, i) => ({
  x: 12 + seeded(i + 1) * 456,
  y: 8 + seeded(i + 50) * 120,
  r: 0.6 + seeded(i + 99) * 1.2,
  delay: seeded(i + 7) * 4,
}))

export function PgScene({ className, chips = true }: { className?: string; chips?: boolean }) {
  const reduce = useReducedMotion()

  return (
    <div className={cn('relative', className)} aria-hidden>
      <svg viewBox="0 0 480 360" className="h-auto w-full drop-shadow-[0_30px_60px_rgb(0_0_0/0.45)]">
        <defs>
          <linearGradient id="pg-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b101a" />
            <stop offset="0.6" stopColor="#1d1a4a" />
            <stop offset="1" stopColor="#302c7e" />
          </linearGradient>
          <radialGradient id="pg-moon-glow">
            <stop offset="0" stopColor="#fdd88a" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fdd88a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="pg-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2a3446" />
            <stop offset="1" stopColor="#161d2b" />
          </linearGradient>
          <linearGradient id="pg-side" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#161d2b" />
            <stop offset="1" stopColor="#0b101a" />
          </linearGradient>
          <linearGradient id="pg-lit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#feecc7" />
            <stop offset="1" stopColor="#fba524" />
          </linearGradient>
          <radialGradient id="pg-lamp">
            <stop offset="0" stopColor="#fcbf4d" stopOpacity="0.7" />
            <stop offset="1" stopColor="#fcbf4d" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="pg-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#161d2b" />
            <stop offset="1" stopColor="#0b101a" />
          </linearGradient>
          <clipPath id="pg-frame">
            <rect x="0" y="0" width="480" height="360" rx="28" />
          </clipPath>
        </defs>

        <g clipPath="url(#pg-frame)">
          <rect width="480" height="360" fill="url(#pg-sky)" />

          {/* Stars */}
          {STARS.map((s, i) => (
            <motion.circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="#fff"
              initial={{ opacity: 0.25 }}
              animate={reduce ? undefined : { opacity: [0.2, 0.9, 0.2] }}
              transition={{ duration: 3 + s.delay, repeat: Infinity, delay: s.delay }}
            />
          ))}

          {/* Moon */}
          <circle cx="398" cy="66" r="62" fill="url(#pg-moon-glow)" />
          <circle cx="398" cy="66" r="20" fill="#feecc7" />
          <circle cx="406" cy="60" r="18" fill="#1d1a4a" opacity="0.35" />

          {/* Far skyline */}
          <g fill="#1b2333" opacity="0.9">
            <rect x="0" y="210" width="60" height="150" />
            <rect x="52" y="180" width="44" height="180" />
            <rect x="380" y="196" width="52" height="164" />
            <rect x="426" y="226" width="54" height="134" />
          </g>
          <g fill="#fcbf4d" opacity="0.35">
            {[[14, 230], [30, 252], [62, 200], [76, 232], [392, 214], [410, 246], [440, 244], [456, 270]].map(([x, y], i) => (
              <rect key={i} x={x} y={y} width="6" height="8" rx="1" />
            ))}
          </g>

          {/* Building side (depth) */}
          <path d="M360 120 L392 136 L392 330 L360 330 Z" fill="url(#pg-side)" />
          {/* Building body */}
          <rect x="112" y="120" width="248" height="210" rx="6" fill="url(#pg-body)" />
          {/* Roof parapet and water tank */}
          <rect x="104" y="112" width="264" height="12" rx="4" fill="#3c485c" />
          <rect x="300" y="84" width="34" height="28" rx="4" fill="#3c485c" />
          <rect x="304" y="80" width="26" height="6" rx="3" fill="#4e5c74" />
          <rect x="128" y="96" width="4" height="16" fill="#4e5c74" />
          <rect x="128" y="94" width="20" height="3" rx="1.5" fill="#4e5c74" />

          {/* Sign board */}
          <rect x="176" y="92" width="112" height="22" rx="6" fill="#0b101a" stroke="#fcbf4d" strokeOpacity="0.6" />
          <text x="232" y="107" textAnchor="middle" fontSize="11" fontWeight="700" letterSpacing="2.5" fill="#fdd88a">
            STAYFLOW PG
          </text>

          {/* Floor lines / balconies */}
          {Array.from({ length: ROWS - 1 }, (_, r) => (
            <rect key={r} x="112" y={170 + r * 46} width="248" height="3" fill="#3c485c" opacity="0.8" />
          ))}

          {/* Windows */}
          {Array.from({ length: ROWS }, (_, r) =>
            Array.from({ length: COLS }, (_, c) => {
              const i = r * COLS + c
              const lit = seeded(i + 3) > 0.32
              const flicker = seeded(i + 21) > 0.7
              const x = 128 + c * 38
              const y = 132 + r * 46
              return (
                <g key={i}>
                  <rect x={x} y={y} width="24" height="28" rx="3" fill="#0f1522" />
                  <motion.rect
                    x={x}
                    y={y}
                    width="24"
                    height="28"
                    rx="3"
                    fill="url(#pg-lit)"
                    initial={{ opacity: lit ? 0.92 : 0 }}
                    animate={
                      reduce || !flicker
                        ? undefined
                        : { opacity: lit ? [0.92, 0.92, 0, 0, 0.92] : [0, 0, 0.92, 0.92, 0] }
                    }
                    transition={{ duration: 7 + seeded(i) * 6, repeat: Infinity, delay: seeded(i + 40) * 5, times: [0, 0.45, 0.5, 0.9, 1] }}
                  />
                  <rect x={x + 11} y={y} width="2" height="28" fill="#0b101a" opacity="0.35" />
                </g>
              )
            }),
          )}

          {/* Entrance */}
          <rect x="214" y="290" width="44" height="40" rx="4" fill="url(#pg-lit)" opacity="0.95" />
          <rect x="235" y="290" width="2" height="40" fill="#b44409" opacity="0.5" />
          <rect x="206" y="284" width="60" height="6" rx="3" fill="#3c485c" />

          {/* Lamps */}
          {[176, 296].map((x) => (
            <g key={x}>
              <circle cx={x} cy="300" r="26" fill="url(#pg-lamp)" />
              <rect x={x - 1.5} y="300" width="3" height="30" fill="#4e5c74" />
              <circle cx={x} cy="299" r="4.5" fill="#fdd88a" />
            </g>
          ))}

          {/* Trees */}
          {[[78, 300, 26], [420, 306, 22], [100, 314, 18]].map(([x, y, r], i) => (
            <g key={i}>
              <rect x={x - 2} y={y} width="4" height="30" fill="#161d2b" />
              <circle cx={x} cy={y - 4} r={r} fill="#161d2b" />
              <circle cx={x - r / 2} cy={y + 4} r={r * 0.7} fill="#1b2333" />
            </g>
          ))}

          {/* Ground */}
          <rect x="0" y="330" width="480" height="30" fill="url(#pg-ground)" />
          <rect x="0" y="330" width="480" height="1.5" fill="#fcbf4d" opacity="0.25" />
        </g>
        <rect x="0.5" y="0.5" width="479" height="359" rx="27.5" fill="none" stroke="#ffffff" strokeOpacity="0.12" />
      </svg>

      {chips && (
        <>
          <Chip className="-left-8 top-[16%] xl:-left-24" delay={0.5} icon={IndianRupee} tone="emerald" title="₹9,000 paid" sub="Room 204 · Arjun" />
          <Chip className="-right-8 top-[30%] xl:-right-24" delay={0.8} icon={BedDouble} tone="indigo" title="Bed 105-B reserved" sub="Moves in 1 Nov" float={-1} />
          <Chip className="-left-8 bottom-[14%] xl:-left-28" delay={1.1} icon={UtensilsCrossed} tone="gold" title="48 dinners tonight" sub="Kitchen count" float={-1} />
          <Chip className="-right-8 bottom-[0%] xl:-right-24" delay={1.4} icon={Zap} tone="gold" title="Room 101 · 120 units" sub="Split by days stayed" />
        </>
      )}
    </div>
  )
}

const TONES = {
  emerald: 'from-emerald-400/30 to-emerald-500/10 text-emerald-300 ring-emerald-300/30',
  indigo: 'from-blue-400/30 to-blue-500/10 text-blue-200 ring-blue-300/30',
  gold: 'from-marigold-300/30 to-marigold-400/10 text-marigold-200 ring-marigold-300/30',
} as const

function Chip({
  className,
  delay,
  icon: Icon,
  tone,
  title,
  sub,
  float = 1,
}: {
  className: string
  delay: number
  icon: typeof Zap
  tone: keyof typeof TONES
  title: string
  sub: string
  float?: 1 | -1
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      // Phones show the building on its own; the cards join from tablet up.
      className={cn('absolute hidden sm:block', className)}
    >
      <motion.div
        animate={reduce ? undefined : { y: [0, -8 * float, 0] }}
        transition={{ duration: 5 + delay, repeat: Infinity, ease: 'easeInOut' }}
        className="flex items-center gap-2.5 rounded-2xl border border-white/15 bg-white/[0.08] py-2 pl-2 pr-3.5 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.7)] backdrop-blur-xl"
      >
        <span className={cn('flex size-9 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset', TONES[tone])}>
          <Icon className="size-[18px]" />
        </span>
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold text-white">{title}</span>
          <span className="block text-[11px] text-white/55">{sub}</span>
        </span>
      </motion.div>
    </motion.div>
  )
}
