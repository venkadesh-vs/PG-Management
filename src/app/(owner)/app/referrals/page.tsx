import type { Metadata } from 'next'
import { Gift, Hourglass, IndianRupee, Send, UserPlus } from 'lucide-react'
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
        subtitle={`Invite up to ${data.slots.limit} PG owners. When one pays their first month, you get ${data.percent}% of it as credit on your bill.`}
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
              Your friend pays ₹14,000. You get ₹7,000 off your next bill.
            </h2>
            <ol className="mt-4 space-y-3 text-sm text-slate-700">
              {[
                [Send, 'Share your code or link with a PG owner you know.'],
                [UserPlus, 'They sign up (or book a demo) with your code and start their free trial.'],
                [IndianRupee, `When they pay their first month, ${data.percent}% of what they paid comes off your bills as credit, up to half of each bill. Anything left carries to the next one.`],
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
            {data.slots.expired ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <Hourglass className="size-4" />
                  Your referral code has expired
                </p>
                <p className="mt-1 font-mono text-lg font-semibold tracking-widest text-amber-900/50 line-through">{data.code}</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  It has been used by {data.slots.limit} PG owners, the most one code allows. Every reward you have earned is
                  still applied to your bills.
                </p>
              </div>
            ) : (
              <ShareReferral code={data.code} link={link} percent={data.percent} />
            )}
            <div className="pt-2">
              <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                <span>
                  Used by {data.slots.used} of {data.slots.limit} PG owners
                </span>
                <span className={data.slots.expired ? 'text-amber-700' : 'text-emerald-700'}>
                  {data.slots.expired ? 'Expired' : `${data.slots.left} left`}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-5 gap-1">
                {Array.from({ length: data.slots.limit }, (_, i) => (
                  <span
                    key={i}
                    className={i < data.slots.used ? 'h-2 rounded-full bg-gradient-to-r from-marigold-300 to-marigold-400' : 'h-2 rounded-full bg-slate-200'}
                  />
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <StatGrid cols={4}>
        <StatCard label="Owners joined" value={data.totals.joined} icon="users" hint="With your code" />
        <StatCard label="Credit earned" value={data.totals.credit} format="money" icon="gift" tone="emerald" hint={`${data.totals.earned} paid their first month`} />
        <StatCard label="Credit left" value={data.balance} format="money" icon="calendar" hint="Comes off your next bill" />
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
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={STATUS_BADGE[r.status]} size="sm">
                      {REFERRAL_STATUS_LABEL[r.status]}
                    </Badge>
                    {r.credit > 0 && <span className="text-xs font-semibold text-emerald-700">{formatMoney(r.credit)} credit</span>}
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
          <p>· You get {data.percent}% of the new owner&apos;s first month as credit, the same whether you have one PG or many. It takes up to half off each combined bill, so you always pay at least half; anything left carries to the next bill until it is used up. Example: a ₹7,000 bill with ₹20,000 credit is ₹3,500 for five months, then ₹4,500.</p>
          <p>· Each owner who pays adds more credit to your balance.</p>
          <p>· Credit is used on bills you pay with Pay now or UPI. A PG still on its own fixed AutoPay mandate is charged in full.</p>
          <p>· Each code works for up to 5 new PG owners, then it expires. You cannot use your own code, and each new owner can be referred once.</p>
        </CardContent>
      </Card>
    </div>
  )
}
