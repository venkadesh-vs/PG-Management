import type { Metadata, Viewport } from 'next'
import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import Script from 'next/script'
import { ToastProvider } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/primitives'
import { publicEnv } from '@/lib/env'
import './globals.css'

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: {
    default: `${publicEnv.appName} — PG Management Software for Owners`,
    template: `%s · ${publicEnv.appName}`,
  },
  description:
    'Replace notebooks, WhatsApp and phone calls with one automated PG management platform. Residents, rooms, rent, payments, complaints, food, staff and expenses in one place.',
  applicationName: publicEnv.appName,
  authors: [{ name: publicEnv.appName }],
  keywords: [
    'PG management software',
    'PG management system',
    'hostel management software',
    'PG rent management',
    'PG room management',
    'PG tenant management',
    "men's PG management",
    "women's PG management",
  ],
  openGraph: {
    type: 'website',
    siteName: publicEnv.appName,
    title: `${publicEnv.appName} — Run your entire PG from one place`,
    description:
      'Automated PG management: residents, rooms and beds, rent collection, WhatsApp reminders, complaints, food, staff and reports.',
    url: publicEnv.siteUrl,
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${publicEnv.appName} — Run your entire PG from one place`,
    description:
      'Replace notebooks, WhatsApp and phone calls with one automated PG management platform.',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // `data-scroll-behavior="smooth"` is required in Next 16: globals.css sets
  // `scroll-behavior: smooth` for in-page anchors, and without this attribute
  // Next no longer neutralises it during route changes — every navigation
  // would animate its scroll to the top instead of jumping.
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${sans.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background font-sans">
        <ToastProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </ToastProvider>

        {/* Analytics stays optional and provider-agnostic; blank env = no tracking. */}
        {publicEnv.analyticsProvider === 'plausible' && publicEnv.analyticsDomain && (
          <Script
            defer
            data-domain={publicEnv.analyticsDomain}
            src="https://plausible.io/js/script.js"
          />
        )}
        {publicEnv.analyticsProvider === 'umami' && publicEnv.analyticsScript && (
          <Script defer src={publicEnv.analyticsScript} data-website-id={publicEnv.analyticsDomain} />
        )}
      </body>
    </html>
  )
}
