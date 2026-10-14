'use client'

import { motion, useReducedMotion } from 'framer-motion'

/**
 * Each page eases in: a short rise and fade. Used by the route groups'
 * template.tsx so it replays on every navigation while the shell stays put.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion()
  if (reduce) return <>{children}</>
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}
