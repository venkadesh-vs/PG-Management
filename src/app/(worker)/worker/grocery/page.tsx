import type { Metadata } from 'next'
import { AlertTriangle, ShoppingCart } from 'lucide-react'
import { redirect } from 'next/navigation'
import { requireWorker } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UNIT_LABEL, purchasePlan } from '@/server/services/kitchen'
import { cn, formatMoney } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { WorkerPurchaseButton } from './worker-purchase-button'

export const metadata: Metadata = { title: 'Grocery' }

export default async function WorkerGroceryPage() {
  const user = await requireWorker()
  // Not part of this person's role (or the module is off): back to home.
  if (!user.permissions.includes('grocery.view')) redirect('/worker')

  const staff = await prisma.staff.findUnique({
    where: { id: user.staffId },
    include: { property: { select: { id: true, name: true } } },
  })

  if (!staff?.property) {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Grocery</h1>
        <EmptyState
          icon="cart"
          title="No PG assigned"
          description="Ask your PG owner to assign you to a property to see the shopping list."
        />
      </div>
    )
  }

  const property = staff.property
  const plan = await purchasePlan(property.id, 7)
  const toBuy = plan.filter((item) => item.needsPurchase)
  const lowStock = plan.filter((item) => item.currentStock <= item.minimumStock)
  const estimated = toBuy.reduce((s, i) => s + i.estimatedCost, 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Grocery</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {property.name} · what to buy and what is running out.
        </p>
      </div>

      {lowStock.length > 0 && (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600" />
            <div>
              <p className="text-sm font-semibold text-red-900">
                {lowStock.length} item{lowStock.length === 1 ? '' : 's'} below minimum
              </p>
              <p className="mt-0.5 text-sm text-red-800/80">
                {lowStock.map((i) => i.name).join(', ')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {toBuy.length === 0 ? (
        <EmptyState
          icon="cart"
          title="Nothing to buy"
          description="Stock is above the minimum for the next seven days."
        />
      ) : (
        <>
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50">
                  <ShoppingCart className="size-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {toBuy.length} item{toBuy.length === 1 ? '' : 's'} to buy
                  </p>
                  <p className="text-xs text-slate-500">
                    About {formatMoney(estimated)} · next 7 days
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <ul className="space-y-2">
            {toBuy.map((item) => {
              const low = item.currentStock <= item.minimumStock
              return (
                <li key={item.id}>
                  <Card className={cn(low && 'border-red-200')}>
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-medium text-slate-900">{item.name}</p>
                          {low && (
                            <Badge variant="danger" size="sm">
                              Low
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          {item.currentStock}
                          {UNIT_LABEL[item.unit]} in stock · minimum {item.minimumStock}
                          {UNIT_LABEL[item.unit]}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-display text-lg font-semibold text-amber-700 tabular">
                          {item.shortfall}
                          <span className="text-xs font-medium">{UNIT_LABEL[item.unit]}</span>
                        </p>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">to buy</p>
                      </div>
                      {user.permissions.includes('grocery.manage') && (
                      <WorkerPurchaseButton
                        propertyId={property.id}
                        item={{
                          id: item.id,
                          name: item.name,
                          unit: UNIT_LABEL[item.unit],
                          suggestedQuantity: item.shortfall,
                          lastPrice: item.lastPurchasePrice,
                        }}
                      />
                      )}
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <p className="text-center text-xs text-slate-400">
        Recording a purchase tops up the stock and files the expense automatically — your PG owner
        does not need to re-enter it.
      </p>
    </div>
  )
}
