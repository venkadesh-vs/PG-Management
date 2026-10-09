import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { publicEnv } from '@/lib/public-env'
import { SiteFooter, SiteHeader } from '@/components/marketing/site-chrome'
import { Hero } from '@/components/marketing/hero'
import { StorySection } from '@/components/marketing/story'
import { ConnectedSection } from '@/components/marketing/connected'
import { ElectricitySection } from '@/components/marketing/electricity'
import { AutopaySection } from '@/components/marketing/autopay'
import {
  BedsSection,
  ComplaintsSection,
  EnquiriesSection,
  FoodSection,
  RentSection,
  ResidentAppSection,
  ResidentsSection,
  RevenueSection,
} from '@/components/marketing/sections'
import { FaqSection, PricingSection } from '@/components/marketing/pricing'
import { DemoSection, FinalCta } from '@/components/marketing/demo-form'
import { FAQS } from '@/components/marketing/faq-data'

const TITLE = 'StayFlow — The Operating System for PGs'
const DESCRIPTION =
  'Your PG. Finally under control. StayFlow helps PG owners manage beds, residents, rent, staff, food, complaints and profit — from one place. Start free.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    'PG management software',
    'paying guest management',
    'hostel management software',
    'PG rent collection',
    'PG bed management',
    'co-living management',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    title: 'StayFlow — Your PG. Finally under control.',
    description:
      'The operating system for PG owners: beds, residents, rent, staff, food, complaints and profit in one place.',
    url: publicEnv.siteUrl,
    siteName: publicEnv.appName,
    type: 'website',
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'StayFlow — Your PG. Finally under control.',
    description: 'The operating system for PG owners: beds, residents, rent, staff, food, complaints and profit.',
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

  // Structured data: what the product is, who makes it, and the FAQ — no
  // ratings or review counts, because the site deliberately has none.
  const organizationId = `${publicEnv.siteUrl}/#organization`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: publicEnv.legalName || publicEnv.appName,
        alternateName: publicEnv.appName,
        url: publicEnv.siteUrl,
        logo: `${publicEnv.siteUrl}/icons/owner-512.png`,
        email: publicEnv.contactEmail,
        ...(publicEnv.contactPhone ? { telephone: publicEnv.contactPhone } : {}),
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'sales',
          email: publicEnv.contactEmail,
          areaServed: 'IN',
          availableLanguage: ['en'],
        },
      },
      {
        '@type': 'SoftwareApplication',
        name: publicEnv.appName,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'PG and hostel management',
        operatingSystem: 'Web, Android, iOS (browser)',
        description: DESCRIPTION,
        url: publicEnv.siteUrl,
        publisher: { '@id': organizationId },
        featureList: [
          'Live bed map',
          'Resident check-in and KYC',
          'Automatic rent invoices and reminders',
          'Room electricity meters split by days stayed',
          'Rent AutoPay by UPI, eMandate or card on each resident’s chosen date',
          'UPI rent collection',
          'Enquiries and bookings',
          'Food planning and meal counts',
          'Complaints with worker assignment',
          'Vacancy loss and profit reports',
          'Resident app and worker app',
        ],
        offers: {
          '@type': 'Offer',
          priceCurrency: 'INR',
          ...(rule.basis === 'FLAT' ? { price: rule.flatPrice } : {}),
          description: 'Priced per PG per month, with a free trial.',
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQS.map((faq) => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: { '@type': 'Answer', text: faq.a },
        })),
      },
    ],
  }

  return (
    <div className="min-h-dvh bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      <SiteHeader />

      <main id="main">
        <Hero />
        <StorySection />
        <ConnectedSection />
        <BedsSection />
        <ResidentsSection />
        <RentSection />
        <ElectricitySection />
        <AutopaySection />
        <EnquiriesSection />
        <FoodSection />
        <ComplaintsSection />
        <RevenueSection />
        <ResidentAppSection />
        <PricingSection rule={rule} />
        <FaqSection />
        <DemoSection />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  )
}
