import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { QrCode } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { maskTail } from '@/lib/crypto'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RazorpayConnect } from './razorpay-connect'

export const metadata: Metadata = { title: 'Online payments' }

export default async function PaymentSettingsPage() {
  const user = await requireOrgUser()
  // Keys move money into the owner's bank: owners only.
  if (user.role !== 'OWNER') redirect('/app/settings')

  const [credential, settings] = await Promise.all([
    prisma.integrationCredential.findUnique({
      where: { organizationId_kind: { organizationId: user.organizationId, kind: 'RAZORPAY' } },
    }),
    prisma.orgSetting.findUnique({
      where: { organizationId: user.organizationId },
      select: { upiId: true, upiPayeeName: true },
    }),
  ])

  const connected = Boolean(credential?.active)
  const encryptionReady = Buffer.from(serverEnv.dataEncryptionKey, 'base64').length === 32

  return (
    <div className="space-y-6">
      <PageHeader
        title="Online payments"
        subtitle="Connect your own Razorpay account so residents can pay rent by UPI, card or netbanking — straight into your bank, with receipts recorded automatically."
        icon="wallet"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Settings', href: '/app/settings' },
          { label: 'Online payments' },
        ]}
      />

      <RazorpayConnect
        status={{
          connected,
          keyId: credential ? maskTail(credential.publicId, 6) : null,
          mode: credential ? (credential.publicId.startsWith('rzp_live_') ? 'live' : 'test') : null,
          verifiedAt: credential?.verifiedAt?.toISOString() ?? null,
          lastError: credential?.lastError ?? null,
        }}
        webhookUrl={`${serverEnv.appUrl}/api/webhooks/razorpay/org/${user.organizationId}`}
        encryptionReady={encryptionReady}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <QrCode className="size-4 text-slate-400" />
            UPI fallback
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <p>
            {connected
              ? 'Residents also see your UPI ID as an alternative. UPI payments made outside Razorpay must be marked received by you.'
              : 'Until Razorpay is connected, residents pay you directly by UPI (deep link or copy UPI ID) and you mark the payment received.'}
          </p>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            {settings?.upiId ? (
              <p className="break-all font-mono text-sm text-slate-800">
                {settings.upiId}
                {settings.upiPayeeName ? (
                  <span className="font-sans text-slate-500"> · {settings.upiPayeeName}</span>
                ) : null}
              </p>
            ) : (
              <p className="text-amber-700">No UPI ID set yet.</p>
            )}
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/app/settings">Edit UPI details in Settings</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
