'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, CalendarClock, Check, MessageCircle, PartyPopper, PlayCircle, Send, ShieldCheck } from 'lucide-react'
import type { z } from 'zod'
import { leadSchema } from '@/lib/validation'
import { api } from '@/lib/client'
import { publicEnv, whatsappLink } from '@/lib/public-env'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { Reveal } from '@/components/motion/reveal'
import { Eyebrow } from './kit'

type Values = z.infer<typeof leadSchema>

const WA_MESSAGE = "Hi, I manage a PG and I'm interested in seeing a demo of StayFlow."

/** Empty optional number inputs must stay `undefined`, not 0 (which fails min(1)). */
const optionalNumber = (value: unknown) => {
  if (value === '' || value === null || value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * The enquiry form. Submissions go straight into the Super Admin's lead
 * pipeline — they are never shown publicly anywhere.
 */
export function DemoForm() {
  const toast = useToast()
  const reduce = useReducedMotion()
  const [done, setDone] = React.useState(false)
  const wa = whatsappLink(WA_MESSAGE)

  const form = useForm<Values>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      name: '',
      phone: '',
      whatsapp: '',
      email: '',
      pgName: '',
      pgCount: 1,
      pgTypes: 'MENS',
      bedCount: undefined,
      rentRange: '',
      currentMethod: '',
      city: '',
      preferredDemoAt: '',
      message: '',
      source: 'website',
    },
  })
  const errors = form.formState.errors

  async function onSubmit(values: Values) {
    try {
      await api.post('/api/leads', values)
      setDone(true)
      toast.success('Thanks — we have your details', 'We will call you shortly to arrange a demo.')
    } catch (error) {
      toast.fromError(error, 'send your demo request')
    }
  }

  if (done) {
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-lift"
        role="status"
      >
        <motion.div
          initial={reduce ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 18 }}
          className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100"
        >
          <PartyPopper className="size-8 text-emerald-600" aria-hidden />
        </motion.div>
        <h3 className="mt-4 font-display text-2xl font-bold tracking-tight text-slate-900">You&apos;re on the list</h3>
        <p className="mx-auto mt-2 max-w-md text-slate-600">
          Thanks! We&apos;ll contact you shortly to understand your PG and arrange a demo at a time that suits you.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          {wa && (
            <Button variant="primary" asChild>
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden />
                Message us now on WhatsApp
              </a>
            </Button>
          )}
          <Button variant="outline" onClick={() => setDone(false)}>
            Send another enquiry
          </Button>
        </div>
      </motion.div>
    )
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-elevated sm:p-8"
      noValidate
      aria-label="Book a demo"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" required htmlFor="lead-name" error={errors.name?.message}>
          <Input id="lead-name" autoComplete="name" placeholder="Ramesh Krishnan" {...form.register('name')} />
        </Field>
        <Field label="Phone number" required htmlFor="lead-phone" error={errors.phone?.message}>
          <Input id="lead-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="98400 12345" {...form.register('phone')} />
        </Field>

        <Field label="WhatsApp number" htmlFor="lead-wa" hint="Leave blank if it is the same" error={errors.whatsapp?.message}>
          <Input id="lead-wa" type="tel" inputMode="tel" {...form.register('whatsapp')} />
        </Field>
        <Field label="Email" htmlFor="lead-email" error={errors.email?.message}>
          <Input id="lead-email" type="email" autoComplete="email" placeholder="you@example.com" {...form.register('email')} />
        </Field>

        <Field label="PG name" htmlFor="lead-pg" error={errors.pgName?.message}>
          <Input id="lead-pg" placeholder="Sree Balaji PG" {...form.register('pgName')} />
        </Field>
        <Field label="City" htmlFor="lead-city" error={errors.city?.message}>
          <Input id="lead-city" autoComplete="address-level2" placeholder="Chennai" {...form.register('city')} />
        </Field>

        <Field label="How many PGs?" required htmlFor="lead-count">
          <Select id="lead-count" {...form.register('pgCount')}>
            {[1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n === 20 ? '20 or more' : n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What kind?" htmlFor="lead-type">
          <Select id="lead-type" {...form.register('pgTypes')}>
            <option value="MENS">Men&apos;s PG</option>
            <option value="WOMENS">Women&apos;s PG</option>
            <option value="BOTH">Both</option>
          </Select>
        </Field>

        <Field label="Approximate number of beds" htmlFor="lead-beds" hint="Optional" error={errors.bedCount?.message}>
          <Input
            id="lead-beds"
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="80"
            {...form.register('bedCount', { setValueAs: optionalNumber })}
          />
        </Field>
        <Field label="Typical rent range" htmlFor="lead-rent">
          <Input id="lead-rent" placeholder="₹7,000 – ₹9,500" {...form.register('rentRange')} />
        </Field>

        <Field label="How do you manage it today?" htmlFor="lead-method">
          <Select id="lead-method" {...form.register('currentMethod')}>
            <option value="">Select</option>
            <option value="Notebook only">Notebook only</option>
            <option value="Notebook + WhatsApp">Notebook + WhatsApp</option>
            <option value="Excel sheet">Excel sheet</option>
            <option value="Another PG software">Another PG software</option>
            <option value="Nothing formal">Nothing formal</option>
          </Select>
        </Field>
        <Field label="Preferred demo time" htmlFor="lead-time" hint="We will confirm by phone">
          <Input id="lead-time" type="datetime-local" {...form.register('preferredDemoAt')} />
        </Field>

        <Field label="Anything else?" htmlFor="lead-msg" className="sm:col-span-2">
          <Textarea id="lead-msg" rows={3} placeholder="What is the most painful part of running your PG right now?" {...form.register('message')} />
        </Field>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" variant="primary" size="lg" className="flex-1" loading={form.formState.isSubmitting}>
          {!form.formState.isSubmitting && <Send aria-hidden />}
          Book my demo
        </Button>
        {wa && (
          <Button variant="outline" size="lg" asChild>
            <a href={wa} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="text-emerald-600" aria-hidden />
              WhatsApp instead
            </a>
          </Button>
        )}
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Your details go only to the {publicEnv.appName} team so we can call you about a demo. We do not publish them,
        sell them, or add you to a mailing list.
      </p>
    </form>
  )
}

/** The "Book a demo" section: what to expect on the left, the form on the right. */
export function DemoSection() {
  return (
    <section id="demo" aria-labelledby="demo-title" className="relative scroll-mt-24 overflow-hidden bg-white py-16 sm:py-24">
      <div className="dot-grid absolute inset-0 -z-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden />
      <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <Reveal className="min-w-0">
          <Eyebrow icon={PlayCircle}>Book a demo</Eyebrow>
          <h2 id="demo-title" className="mt-4 font-display text-[1.75rem] font-semibold leading-[1.15] tracking-tight text-slate-900 text-balance sm:text-4xl">
            See StayFlow with your own PG&apos;s numbers.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            Tell us a little about your PG and we&apos;ll walk you through exactly how it would run on StayFlow — not a
            generic slide deck.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              'Your floors and beds set up live on the call',
              'How rent, reminders and receipts would work for you',
              'Honest answers on pricing and fit',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-50 ring-1 ring-inset ring-blue-200">
                  <Check className="size-3 text-blue-700" strokeWidth={3} aria-hidden />
                </span>
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-6 flex items-center gap-1.5 text-sm text-slate-500">
            <CalendarClock className="size-4" aria-hidden />
            About 20 minutes, on a call or over WhatsApp.
          </p>
        </Reveal>
        <Reveal delay={0.1} className="min-w-0">
          <DemoForm />
        </Reveal>
      </div>
    </section>
  )
}

/** The closing call-to-action band. */
export function FinalCta() {
  return (
    <section aria-labelledby="final-cta-title" className="grain relative isolate overflow-hidden bg-slate-950 py-20 text-white sm:py-28">
      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="aurora opacity-60" />
        <div className="absolute left-1/2 top-0 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-blue-400/60 to-transparent" />
      </div>
      <Reveal className="relative mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
        <h2 id="final-cta-title" className="font-display text-[2.25rem] font-bold leading-[1.06] tracking-[-0.03em] text-balance sm:text-5xl">
          Your PG. <span className="bg-gradient-to-br from-blue-200 to-blue-400 bg-clip-text text-transparent">Finally under control.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/70 text-pretty sm:text-lg">
          Beds, residents, rent, staff, food, complaints and profit — in one place, from today.
        </p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <Button variant="outline" size="xl" asChild className="border-white bg-white text-slate-900 hover:bg-slate-100 hover:text-slate-900">
            <a href="/signup">
              Start free
              <ArrowRight className="group-hover/btn:translate-x-0.5" aria-hidden />
            </a>
          </Button>
          <Button variant="ghost" size="xl" asChild className="border border-white/20 text-white hover:bg-white/10 hover:text-white">
            <a href="#demo">
              <PlayCircle aria-hidden />
              Book a demo
            </a>
          </Button>
        </div>
        <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-white/60">
          {['No setup fee', 'Free trial', 'Cancel anytime'].map((item) => (
            <li key={item} className="flex items-center gap-1.5">
              <Check className="size-3.5 text-blue-300" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  )
}
