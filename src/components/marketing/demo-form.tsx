'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { motion } from 'framer-motion'
import { CalendarClock, Check, MessageCircle, PartyPopper, Send, ShieldCheck } from 'lucide-react'
import type { z } from 'zod'
import { leadSchema } from '@/lib/validation'
import { api, ApiError } from '@/lib/client'
import { publicEnv, whatsappLink } from '@/lib/public-env'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

type Values = z.infer<typeof leadSchema>

/**
 * The enquiry form. Submissions go straight into the Super Admin's lead
 * pipeline — they are never shown publicly anywhere.
 */
export function DemoForm() {
  const toast = useToast()
  const [done, setDone] = React.useState(false)
  const wa = whatsappLink(
    "Hi, I manage a PG and I'm interested in seeing a demo of your PG management software.",
  )

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

  async function onSubmit(values: Values) {
    try {
      await api.post('/api/leads', values)
      setDone(true)
      toast.success('Thanks — we have your details', 'We will call you shortly to arrange a demo.')
    } catch (error) {
      toast.error(
        'Unable to send this right now',
        error instanceof ApiError ? error.message : 'Please try again, or message us on WhatsApp.',
      )
    }
  }

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-elevated"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 18 }}
          className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100"
        >
          <PartyPopper className="size-8 text-emerald-600" />
        </motion.div>
        <h3 className="mt-4 font-display text-2xl font-semibold tracking-tight text-slate-900">
          You&apos;re on the list 🎉
        </h3>
        <p className="mx-auto mt-2 max-w-md text-slate-600">
          Thanks! We&apos;ll contact you shortly to understand your PG and arrange a demo at a time
          that suits you.
        </p>

        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          {wa && (
            <Button variant="primary" asChild>
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" />
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
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-elevated sm:p-8"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" required error={form.formState.errors.name?.message}>
          <Input placeholder="Ramesh Krishnan" {...form.register('name')} />
        </Field>
        <Field label="Phone number" required error={form.formState.errors.phone?.message}>
          <Input inputMode="tel" placeholder="98400 12345" {...form.register('phone')} />
        </Field>

        <Field
          label="WhatsApp number"
          hint="Leave blank if it is the same"
          error={form.formState.errors.whatsapp?.message}
        >
          <Input inputMode="tel" {...form.register('whatsapp')} />
        </Field>
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" placeholder="you@example.com" {...form.register('email')} />
        </Field>

        <Field label="PG name" error={form.formState.errors.pgName?.message}>
          <Input placeholder="Sree Balaji PG" {...form.register('pgName')} />
        </Field>
        <Field label="City" error={form.formState.errors.city?.message}>
          <Input placeholder="Chennai" {...form.register('city')} />
        </Field>

        <Field label="How many PGs?" required>
          <Select {...form.register('pgCount')}>
            {[1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n === 20 ? '20 or more' : n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What kind?">
          <Select {...form.register('pgTypes')}>
            <option value="MENS">Men&apos;s PG</option>
            <option value="WOMENS">Women&apos;s PG</option>
            <option value="BOTH">Both</option>
          </Select>
        </Field>

        <Field label="Approximate number of beds" error={form.formState.errors.bedCount?.message}>
          <Input type="number" inputMode="numeric" placeholder="80" {...form.register('bedCount')} />
        </Field>
        <Field label="Typical rent range">
          <Input placeholder="₹7,000 – ₹9,500" {...form.register('rentRange')} />
        </Field>

        <Field label="How do you manage it today?">
          <Select {...form.register('currentMethod')}>
            <option value="">Select</option>
            <option value="Notebook only">Notebook only</option>
            <option value="Notebook + WhatsApp">Notebook + WhatsApp</option>
            <option value="Excel sheet">Excel sheet</option>
            <option value="Another PG software">Another PG software</option>
            <option value="Nothing formal">Nothing formal</option>
          </Select>
        </Field>
        <Field label="Preferred demo time" hint="We will confirm by phone">
          <Input type="datetime-local" {...form.register('preferredDemoAt')} />
        </Field>

        <Field label="Anything else?" className="sm:col-span-2">
          <Textarea
            rows={3}
            placeholder="What is the most painful part of running your PG right now?"
            {...form.register('message')}
          />
        </Field>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="flex-1"
          loading={form.formState.isSubmitting}
        >
          {!form.formState.isSubmitting && <Send className="size-4" />}
          Book my free demo
        </Button>
        {wa && (
          <Button variant="outline" size="lg" asChild>
            <a href={wa} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4 text-emerald-600" />
              WhatsApp instead
            </a>
          </Button>
        )}
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        Your details go only to the {publicEnv.appName} team so we can call you about a demo. We do
        not publish them, sell them, or add you to a mailing list.
      </p>
    </form>
  )
}

/** The closing call-to-action band. */
export function FinalCta() {
  const wa = whatsappLink(
    "Hi, I manage a PG and I'm interested in seeing a demo of your PG management software.",
  )
  return (
    <section className="relative overflow-hidden bg-slate-950 py-20 text-white sm:py-24">
      <div className="mesh-blue absolute inset-0 opacity-40" aria-hidden />
      <div className="dot-grid absolute inset-0 opacity-[0.07]" aria-hidden />
      <div className="relative mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Your PG is growing. Your management should too.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-white/70 text-pretty">
            Replace notebooks, WhatsApp and phone calls with one automated PG management platform.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button variant="secondary" size="xl" asChild className="bg-white text-slate-900 hover:bg-white/90">
              <a href="#demo">
                <CalendarClock className="size-4" />
                Book a free demo
              </a>
            </Button>
            {wa && (
              <Button
                variant="ghost"
                size="xl"
                asChild
                className="border border-white/20 text-white hover:bg-white/10 hover:text-white"
              >
                <a href={wa} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="size-4" />
                  Talk to us on WhatsApp
                </a>
              </Button>
            )}
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-white/60">
            {['No setup fee', 'Free trial', 'Cancel anytime'].map((item) => (
              <span key={item} className="flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-400" />
                {item}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
