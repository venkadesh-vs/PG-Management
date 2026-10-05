import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor } from '@/lib/theme'
import { addDays, cn, formatDate, formatMoney } from '@/lib/utils'

import { UNIT_LABEL, purchasePlan } from '@/server/services/kitchen'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives'
import { QuickForm } from '@/components/app/quick-form'
import { PurchaseButton } from './purchase-button'

export const metadata: Metadata = { title: 'Grocery' }

export default async function GroceryPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>
}) {
  const user = await requireOrgUser()
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const properties = await prisma.property.findMany({
    where: { id: { in: propertyIds } },
    select: { id: true, name: true, type: true },
    orderBy: { name: 'asc' },
  })

  if (!properties.length) {
    return (
      <div className="space-y-6">
        <PageHeader title="Grocery" subtitle="Stock, alerts and purchases." icon="cart" />
        <EmptyState icon="building" title="No PG yet" description="Add a PG to start tracking stock." />
      </div>
    )
  }

  const activeProperty = scope.propertyId ?? properties[0].id

  const [plan, purchases, spendThisMonth, items] = await Promise.all([
    purchasePlan(activeProperty, 7),
    prisma.groceryPurchase.findMany({
      where: { propertyId: { in: propertyIds }, purchaseDate: { gte: addDays(new Date(), -30) } },
      include: {
        groceryItem: { select: { name: true, unit: true } },
        property: { select: { name: true, type: true } },
      },
      orderBy: { purchaseDate: 'desc' },
      take: 30,
    }),
    prisma.groceryPurchase.aggregate({
      where: {
        propertyId: { in: propertyIds },
        purchaseDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
      _sum: { totalAmount: true },
    }),
    prisma.groceryItem.findMany({
      where: { propertyId: activeProperty },
      select: { id: true, name: true, unit: true, lastPurchasePrice: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const lowStock = plan.filter((item) => item.currentStock <= item.minimumStock)
  const needsBuying = plan.filter((item) => item.needsPurchase)
  const estimatedCost = needsBuying.reduce((s, item) => s + item.estimatedCost, 0)
  const mealsPerDay = plan[0]?.mealsPerDay ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grocery"
        subtitle="Stock, low-stock alerts and a purchase list worked out from your actual meal counts."
        icon="cart"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Grocery' }]}
        actions={
          <>
            <QuickForm
              trigger="Add item"
              triggerVariant="outline"
              title="Add a grocery item"
              description="The per-resident quantity is how the purchase list is worked out. Set it to match how your kitchen actually cooks."
              endpoint="/api/operations"
              payload={{ entity: 'GROCERY_ITEM' }}
              successTitle="Item saved"
              fields={[
                {
                  kind: 'select',
                  name: 'propertyId',
                  label: 'PG',
                  required: true,
                  half: true,
                  defaultValue: activeProperty,
                  options: properties.map((p) => ({ value: p.id, label: p.name })),
                },
                { kind: 'text', name: 'name', label: 'Item name', required: true, half: true },
                { kind: 'text', name: 'category', label: 'Category', required: true, half: true, placeholder: 'Vegetables' },
                {
                  kind: 'select',
                  name: 'unit',
                  label: 'Unit',
                  required: true,
                  half: true,
                  defaultValue: 'KG',
                  options: [
                    { value: 'KG', label: 'Kilogram' },
                    { value: 'GRAM', label: 'Gram' },
                    { value: 'LITRE', label: 'Litre' },
                    { value: 'ML', label: 'Millilitre' },
                    { value: 'PIECE', label: 'Piece' },
                    { value: 'PACKET', label: 'Packet' },
                    { value: 'DOZEN', label: 'Dozen' },
                    { value: 'CYLINDER', label: 'Cylinder' },
                  ],
                },
                { kind: 'number', name: 'currentStock', label: 'Current stock', half: true, defaultValue: 0 },
                { kind: 'number', name: 'minimumStock', label: 'Minimum stock', half: true, defaultValue: 0 },
                {
                  kind: 'number',
                  name: 'perResidentPerMeal',
                  label: 'Per resident, per meal',
                  hint: 'In grams or millilitres for weight/volume items, pieces otherwise. Leave 0 for items that are not consumed per meal.',
                  defaultValue: 0,
                },
                { kind: 'text', name: 'vendor', label: 'Usual vendor' },
              ]}
            />
            <PurchaseButton
              properties={properties}
              defaultPropertyId={activeProperty}
              items={items.map((i) => ({
                id: i.id,
                name: i.name,
                unit: UNIT_LABEL[i.unit],
                lastPrice: i.lastPurchasePrice,
              }))}
            />
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Items tracked" value={plan.length} icon="boxes" tone="blue" />
        <StatCard
          label="Low on stock"
          value={lowStock.length}
          icon="warning"
          tone={lowStock.length > 0 ? 'red' : 'emerald'}
          hint={lowStock.length ? 'Below the minimum' : 'Everything above minimum'}
        />
        <StatCard
          label="Estimated purchase"
          value={estimatedCost}
          format="money"
          icon="cart"
          tone="amber"
          hint={`For the next 7 days · ${mealsPerDay} meals a day`}
        />
        <StatCard
          label="Spent this month"
          value={spendThisMonth._sum.totalAmount ?? 0}
          format="money"
          icon="receipt"
          tone="violet"
        />
      </div>

      {lowStock.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-amber-900">
              <AlertTriangle className="size-4" />
              {lowStock.length} item{lowStock.length === 1 ? '' : 's'} need restocking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {lowStock.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-3 py-1 text-xs"
                >
                  <span className="font-medium text-slate-800">{item.name}</span>
                  <span className="text-amber-700 tabular">
                    {item.currentStock}
                    {UNIT_LABEL[item.unit]} left
                  </span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="list">Purchase list</TabsTrigger>
          <TabsTrigger value="purchases">Recent purchases</TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead className="text-right">Minimum</TableHead>
                  <TableHead className="text-right">Per resident/meal</TableHead>
                  <TableHead className="text-right">Last price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.map((item) => {
                  const low = item.currentStock <= item.minimumStock
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium text-slate-800">{item.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" size="sm">
                          {item.category}
                        </Badge>
                      </TableCell>
                      <TableCell className={cn('text-right tabular', low && 'font-semibold text-red-600')}>
                        {item.currentStock} {UNIT_LABEL[item.unit]}
                      </TableCell>
                      <TableCell className="text-right text-slate-500 tabular">
                        {item.minimumStock} {UNIT_LABEL[item.unit]}
                      </TableCell>
                      <TableCell className="text-right text-slate-500 tabular">
                        {item.perResidentPerMeal || '—'}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {formatMoney(item.lastPurchasePrice)}
                      </TableCell>
                      <TableCell>
                        {low ? (
                          <Badge variant="danger" size="sm">
                            Restock
                          </Badge>
                        ) : (
                          <Badge variant="success" size="sm">
                            OK
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>
        </TabsContent>

        <TabsContent value="list">
          {needsBuying.length === 0 ? (
            <EmptyState
              icon="cart"
              title="Nothing to buy right now"
              description="Everything is above its minimum stock for the next seven days."
            />
          ) : (
            <>
              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">
                Worked out from {mealsPerDay} meals a day over the next 7 days, using each
                item&apos;s configured per-resident quantity. Adjust those quantities on the item to
                match how your kitchen actually cooks — nothing here is assumed for you.
              </div>
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">In stock</TableHead>
                      <TableHead className="text-right">Needed (7 days)</TableHead>
                      <TableHead className="text-right">Shortfall</TableHead>
                      <TableHead className="text-right">Estimated cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {needsBuying.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium text-slate-800">{item.name}</TableCell>
                        <TableCell className="text-right tabular">
                          {item.currentStock} {UNIT_LABEL[item.unit]}
                        </TableCell>
                        <TableCell className="text-right text-slate-500 tabular">
                          {item.estimatedRequirement} {UNIT_LABEL[item.unit]}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-amber-700 tabular">
                          {item.shortfall} {UNIT_LABEL[item.unit]}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {formatMoney(item.estimatedCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
              <p className="mt-3 text-right text-sm font-semibold text-slate-800">
                Estimated total: {formatMoney(estimatedCost)}
              </p>
            </>
          )}
        </TabsContent>

        <TabsContent value="purchases">
          {purchases.length === 0 ? (
            <EmptyState
              icon="cart"
              title="No purchases in the last 30 days"
              description="Recording a purchase tops up stock and creates the matching expense automatically."
            />
          ) : (
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>PG</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((purchase) => {
                    const theme = themeFor(purchase.property.type)
                    return (
                      <TableRow key={purchase.id}>
                        <TableCell className="font-medium text-slate-800">
                          {purchase.groceryItem.name}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm text-slate-600">
                            <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                            {purchase.property.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {purchase.vendor ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {formatDate(purchase.purchaseDate)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {purchase.quantity} {UNIT_LABEL[purchase.groceryItem.unit]}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular">
                          {formatMoney(purchase.totalAmount)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableWrap>
          )}
        </TabsContent>
      </Tabs>

    </div>
  )
}
