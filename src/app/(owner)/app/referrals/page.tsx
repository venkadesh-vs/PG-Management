import type { Metadata } from 'next'
import { Gift, IndianRupee, Send, UserPlus } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { publicEnv } from '@/lib/public-env'
import { referralLink, REFERRAL_STATUS_LABEL } from '@/lib/referrals'
import { formatDate, formatMoney } from '@/lib/utils'
import { referralOverview } from '@/server/services/referrals'
import { PageHeader } from '@/components/app/page-header'
import { StatCard, StatGrid } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { ShareReferral } from './share-referral'

export const metadata: Metadata = { title: 'Refer & earn' }

const STATUS_BADGE = {
  PENDING: 'warning',
  EARNED: 'success',
  APPLYING: 'blue',
  APPLIED: 'default',
  CANCELLED: 'default',
} as const

export default async function ReferralsPage() {
  const user = await requireAccess({ module: 'settings', permission: 'billing.manage', allowRestricted: true })
  const data = await referralOverview(user.organizationId!)
  const link = referralLink(publicEnv.siteUrl, data.code)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refer & earn"
        subtitle={`Invite another PG owner. When they pay their first month, your next month is ${data.percent}% off.`}
        icon="gift"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Refer & earn' }]}
      />

      <Card className="overflow-hidden">
        <CardContent className="grid gap-6 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-5 sm:p-6 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              <Gift className="size-3.5" />
              {data.percent}% off one month for every PG owner you bring
            </p>
            <h2 className="mt-3 font-display text-xl font-semibold tracking-tight text-slate-900">
              Your bill of ₹8,000 becomes ₹4,000 that month.
            </h2>
            <ol className="mt-4 space-y-3 text-sm text-slate-700">
              {[
                [Send, 'Share your code or link with a PG owner you know.'],
                [UserPlus, 'They sign up (or book a demo) with your code and start their free trial.'],
                [IndianRupee, `When they pay their first month, all your PGs' bills for your next month are ${data.percent}% off — automatically.`],
              ].map(([Icon, text], i) => {
                const I = Icon as typeof Send
                return (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-blue-700 shadow-xs ring-1 ring-slate-200">
                      <I className="size-3.5" />
                    </span>
                    <span className="pt-1">{text as string}</span>
                  </li>
                )
              })}
            </ol>
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-semibold text-slate-900">Your referral code</p>
            <ShareReferral code={data.code} link={link} percent={data.percent} />
          </div>
        </CardContent>
      </Card>

      <StatGrid cols={4}>
        <StatCard label="Owners joined" value={data.totals.joined} icon="users" hint="With your code" />
        <StatCard label="Rewards earned" value={data.totals.earned} icon="gift" tone="emerald" hint="They paid their first month" />
        <StatCard label="Waiting to use" value={data.totals.waiting} icon="calendar" hint="Applies to your next bills" />
        <StatCard label="You saved" value={data.totals.saved} format="money" icon="wallet" tone="emerald" />
      </StatGrid>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">People you referred</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.referrals.length ? (
            <EmptyState
              icon="users"
              title="No referrals yet"
              description="Share your code with PG owners you know. They show up here as soon as they sign up."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.referrals.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{r.name}</p>
                    <p className="text-xs text-slate-500">
                      Joined {formatDate(r.joinedAt)}
                      {r.city ? ` · ${r.city}` : ''}
                      {r.earnedAt ? ` · paid ${formatDate(r.earnedAt)}` : ''}
                    </p>
                    {r.bills.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {r.bills.map((b) => (
                          <li key={b} className="text-[11px] text-slate-500">{b}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={STATUS_BADGE[r.status]} size="sm">
                      {REFERRAL_STATUS_LABEL[r.status]}
                    </Badge>
                    {r.saved > 0 && <span className="text-xs font-semibold text-emerald-700">Saved {formatMoney(r.saved)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1.5 p-5 text-xs text-slate-500">
          <p className="text-sm font-semibold text-slate-900">How the reward works</p>
          <p>· The reward unlocks when the owner you referred pays their first StayFlow bill. Signing up alone does not count.</p>
          <p>· It takes {data.percent}% off each of your PGs&apos; bills for one month, starting with your next bill. It never goes below zero.</p>
          <p>· Refer more owners and each reward covers another month. Rewards do not stack on the same bill.</p>
          <p>· A PG on live AutoPay is charged a fixed amount by the bank, so its bill is not discounted. The reward waits for a bill you pay with Pay now.</p>
          <p>· You cannot use your own code, and each new owner can be referred once.</p>
        </CardContent>
      </Card>
    </div>
  )
}
