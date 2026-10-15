'use client'

import * as React from 'react'
import Image from 'next/image'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { HardHat, LayoutDashboard, Smartphone } from 'lucide-react'
import { SectionHeading } from './kit'

/**
 * Real screenshots of StayFlow (taken from the app with sample data), shown
 * as a laptop with two phones: the owner dashboard, the resident app and
 * the staff app. Scroll brings the laptop forward and lifts the phones.
 */
export function ShowcaseSection() {
  const reduce = useReducedMotion()
  const ref = React.useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const laptopScale = useTransform(scrollYProgress, [0, 0.45], [reduce ? 1 : 0.92, 1])
  const laptopY = useTransform(scrollYProgress, [0, 0.45], [reduce ? 0 : 40, 0])
  const leftY = useTransform(scrollYProgress, [0.1, 0.7], [reduce ? 0 : 70, reduce ? 0 : -10])
  const rightY = useTransform(scrollYProgress, [0.1, 0.7], [reduce ? 0 : 110, reduce ? 0 : -20])

  return (
    <section ref={ref} id="showcase" aria-labelledby="showcase-title" className="grain relative isolate overflow-hidden bg-ink-950 py-20 text-white sm:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-24 size-[44rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[140px]" />
        <div className="absolute -right-20 bottom-0 size-[26rem] rounded-full bg-marigold-400/10 blur-[120px]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-marigold-300/40 to-transparent" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          dark
          eyebrow="The real product"
          title={<span id="showcase-title">One system. Three apps. Every screen.</span>}
          description="The owner dashboard on your laptop, the resident app and the staff app on their phones, all working from the same records."
        />

        <div className="relative mx-auto mt-14 max-w-5xl sm:mt-20">
          {/* Laptop: owner dashboard */}
          <motion.div style={{ scale: laptopScale, y: laptopY }} className="relative mx-auto w-full md:w-[86%]">
            <div className="rounded-[1.25rem] bg-gradient-to-b from-white/20 to-white/5 p-[6px] shadow-[0_40px_120px_-30px_rgb(82_72_224/0.55)] ring-1 ring-white/15">
              <div className="overflow-hidden rounded-[0.95rem] bg-ink-900">
                <div className="flex h-7 items-center gap-1.5 border-b border-white/10 bg-white/[0.04] px-3">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-2 rounded-full bg-white/20" />
                  ))}
                  <span className="mx-auto rounded-md bg-white/[0.06] px-3 py-0.5 font-mono text-[10px] text-white/45">app.stayflow · owner dashboard</span>
                </div>
                <Image
                  src="/showcase/owner-dashboard.webp"
                  alt="StayFlow owner dashboard with occupancy, collections, dues and complaints"
                  width={2880}
                  height={1800}
                  sizes="(min-width: 1024px) 860px, 100vw"
                  className="h-auto w-full"
                />
              </div>
            </div>
            <div aria-hidden className="mx-auto h-3 w-[104%] -translate-x-[2%] rounded-b-[1.4rem] bg-gradient-to-b from-white/25 to-white/5" />
          </motion.div>

          {/* Phones: resident and staff apps */}
          <div className="mt-8 flex justify-center gap-4 md:mt-0">
            <motion.div style={{ y: leftY }} className="w-[44%] max-w-[210px] md:absolute md:-left-2 md:bottom-[-10%] md:w-[22%] lg:-left-6">
              <Phone src="/showcase/resident-app.webp" alt="StayFlow resident app home with rent, food and complaints" />
              <Label icon={Smartphone}>Resident app</Label>
            </motion.div>
            <motion.div style={{ y: rightY }} className="w-[44%] max-w-[210px] md:absolute md:-right-2 md:bottom-[-16%] md:w-[22%] lg:-right-6">
              <Phone src="/showcase/staff-app.webp" alt="StayFlow staff app with tasks, meter readings and expenses" />
              <Label icon={HardHat}>Staff app</Label>
            </motion.div>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-2 md:mt-36">
          {[
            [LayoutDashboard, 'Owner dashboard'],
            [Smartphone, 'Resident app, no install'],
            [HardHat, 'Staff app for cook and maintenance'],
          ].map(([Icon, text]) => {
            const I = Icon as typeof Smartphone
            return (
              <span key={text as string} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-white/75">
                <I className="size-3.5 text-marigold-300" aria-hidden />
                {text as string}
              </span>
            )
          })}
        </div>
        <p className="mt-4 text-center text-xs text-white/35">Screenshots of the real app with sample data.</p>
      </div>
    </section>
  )
}

function Phone({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative rounded-[2rem] bg-gradient-to-b from-white/25 to-white/5 p-[5px] shadow-[0_30px_80px_-25px_rgb(0_0_0/0.8)] ring-1 ring-white/15">
      <div className="relative overflow-hidden rounded-[1.7rem] bg-ink-900">
        <span aria-hidden className="absolute left-1/2 top-1.5 z-10 h-4 w-16 -translate-x-1/2 rounded-full bg-black/80" />
        <Image src={src} alt={alt} width={1170} height={2532} sizes="(min-width: 768px) 210px, 44vw" className="h-auto w-full" />
      </div>
    </div>
  )
}

function Label({ icon: Icon, children }: { icon: typeof Smartphone; children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-white/70">
      <Icon className="size-3.5 text-marigold-300" aria-hidden />
      {children}
    </p>
  )
}
