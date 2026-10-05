import type { Metadata } from 'next'
import { CalendarClock } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { publicEnv } from '@/lib/public-env'
import { SiteFooter, SiteHeader } from '@/components/marketing/site-chrome'
import { Hero } from '@/components/marketing/hero'
import {
  AutomationSection,
  MultiPgSection,
  OperationsSection,
  ProblemSection,
  RentSection,
  ResidentAppSection,
  SectionHeading,
  SolutionSection,
  TrustSection,
} from '@/components/marketing/sections'
import { FaqSection, PricingSection } from '@/components/marketing/pricing'
import { DemoForm, FinalCta } from '@/components/marketing/demo-form'

export const metadata: Metadata = {
  title: 'PG Management Software — Run your entire PG from one place',
  description:
    'StayFlow replaces notebooks, WhatsApp and phone calls with one automated PG management platform. Residents, rooms and beds, rent collection, WhatsApp reminders, complaints, food, grocery, staff and reports.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'StayFlow — Run your entire PG from one place',
    description:
      'Automated PG management software for men\'s and women\'s PGs: residents, rooms, rent, complaints, food and staff in one platform.',
    url: publicEnv.siteUrl,
    type: 'website',
  },
}

export default async function LandingPage() {
  // The calculator uses the live default plan, so the site can never quote a
  // price the product would not actually charge.
  const plan = await prisma.plan.findFirst({
    where: { active: true },
    orderBy: { isDefault: 'desc' },
    select: {
      name: true,
      pricingBasis: true,
      multiplier: true,
      perBedPrice: true,
      flatPrice: true,
      minAmount: true,
      maxAmount: true,
      trialDays: true,
    },
  })

  const rule = {
    planName: plan?.name ?? 'Growth',
    basis: plan?.pricingBasis ?? ('STANDARD_RENT' as const),
    multiplier: plan?.multiplier ?? 100,
    perBedPrice: plan?.perBedPrice ?? 90,
    flatPrice: plan?.flatPrice ?? 8000,
    minAmount: plan?.minAmount ?? 3000,
    maxAmount: plan?.maxAmount ?? 25000,
    trialDays: plan?.trialDays ?? 14,
  }

  // Structured data helps the page describe itself to search engines without
  // keyword stuffing the copy.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: publicEnv.appName,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description:
      'PG management software for paying guest and hostel owners: residents, rooms and beds, rent collection, WhatsApp reminders, complaints, food, grocery, staff and reports.',
    url: publicEnv.siteUrl,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'INR',
      description: 'Priced per PG, based on one standard resident rent.',
    },
  }

  return (
    <div className="min-h-dvh bg-white">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <SiteHeader />

      <main>
        <Hero />
        <ProblemSection />
        <SolutionSection />
        <AutomationSection />
        <RentSection />
        <ResidentAppSection />
        <MultiPgSection />
        <OperationsSection />
        <TrustSection />
        <PricingSection rule={rule} />

        {/* ------------------------------------------------------- Demo */}
        <section id="demo" className="scroll-mt-20 bg-slate-50/70 py-20 sm:py-28">
          <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Book a free demo"
              title="See it with your own PG's numbers."
              description="Tell us a little about your PG and we will walk you through exactly how it would work for you — not a generic slide deck."
            />
            <div className="mt-10">
              <DemoForm />
            </div>
            <p className="mt-6 flex items-center justify-center gap-1.5 text-sm text-slate-500">
              <CalendarClock className="size-4" />
              Demos take about 20 minutes, on a call or over WhatsApp.
            </p>
          </div>
        </section>

        <FaqSection />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  )
}
