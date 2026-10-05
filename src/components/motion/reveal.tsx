'use client'

import * as React from 'react'
import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion'

/**
 * The product's shared motion vocabulary, so every screen moves the same way:
 * content rises a few pixels and fades in, lists cascade, pages slide in.
 * Everything collapses to "just show it" when the OS asks for less motion.
 */

export const EASE_OUT = [0.22, 1, 0.36, 1] as const
export const SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const

type RevealProps = HTMLMotionProps<'div'> & {
  delay?: number
  /** Distance travelled, in px. */
  y?: number
  /** Animate when scrolled into view (default) or immediately on mount. */
  onView?: boolean
}

/** Fades and rises its children into place. */
export function Reveal({ delay = 0, y = 14, onView = true, children, ...props }: RevealProps) {
  const reduce = useReducedMotion()
  if (reduce) return <div {...(props as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>
  const target = { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT, delay } }
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      {...(onView ? { whileInView: target, viewport: { once: true, margin: '0px 0px -60px 0px' } } : { animate: target })}
      {...props}
    >
      {children}
    </motion.div>
  )
}

/** Parent that cascades its <StaggerItem> children one after another. */
export function Stagger({
  gap = 0.06,
  delay = 0,
  onView = true,
  children,
  ...props
}: HTMLMotionProps<'div'> & { gap?: number; delay?: number; onView?: boolean }) {
  const reduce = useReducedMotion()
  if (reduce) return <div {...(props as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>
  const variants = { hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }
  return (
    <motion.div
      variants={variants}
      initial="hidden"
      {...(onView ? { whileInView: 'show', viewport: { once: true, margin: '0px 0px -40px 0px' } } : { animate: 'show' })}
      {...props}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ y = 12, children, ...props }: HTMLMotionProps<'div'> & { y?: number }) {
  const reduce = useReducedMotion()
  if (reduce) return <div {...(props as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
      }}
      {...props}
    >
      {children}
    </motion.div>
  )
}

/**
 * Wraps a page's content so navigating between screens feels continuous.
 * Use from a route segment's template.tsx (re-mounts on every navigation).
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion()
  if (reduce) return <>{children}</>
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.45, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  )
}
