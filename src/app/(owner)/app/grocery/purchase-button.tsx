'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ShoppingCart } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { formatMoney, toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'

type Item = { id: string; name: string; unit: string; lastPrice: number }

/**
 * Recording a purchase does three things at once: tops up stock, records the
 * expense against the PG, and clears the low-stock alert.
 */
export function PurchaseButton({
  properties,
  defaultPropertyId,
  items,
}: {
  properties: { id: string; name: string }[]
  defaultPropertyId: string
  items: Item[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [propertyId, setPropertyId] = React.useState(defaultPropertyId)
  const [itemId, setItemId] = React.useState(items[0]?.id ?? '')
  const [quantity, setQuantity] = React.useState('10')
  const [unitPrice, setUnitPrice] = React.useState(String(items[0]?.lastPrice ?? 0))
  const [vendor, setVendor] = React.useState('')
  const [purchaseDate, setPurchaseDate] = React.useState(toISODate(new Date()))
  const [createExpense, setCreateExpense] = React.useState(true)
  const [busy, setBusy] = React.useState(false)

  const item = items.find((i) => i.id === itemId)
  const total = (Number(quantity) || 0) * (Number(unitPrice) || 0)

  function chooseItem(id: string) {
    setItemId(id)
    const next = items.find((i) => i.id === id)
    if (next) setUnitPrice(String(next.lastPrice))
  }

  async function submit() {
    if (!itemId) {
      toast.error('Choose an item', 'Pick what was bought.')
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/operations', {
        entity: 'PURCHASE',
        propertyId,
        groceryItemId: itemId,
        quantity: Number(quantity),
        unitPrice: Number(unitPrice),
        vendor: vendor || undefined,
        purchaseDate,
        createExpense,
      })
      toast.success('Purchase recorded', result.message)
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to record this purchase',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabled={!items.length}>
        <ShoppingCart className="size-4" />
        Record purchase
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a grocery purchase</DialogTitle>
            <DialogDescription>
              Stock goes up, the expense is created against the PG, and any low-stock alert clears
              — all from this one entry.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="PG" required className="sm:col-span-2">
              <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Item" required className="sm:col-span-2">
              <Select value={itemId} onChange={(e) => chooseItem(e.target.value)}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.unit})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={`Quantity${item ? ` (${item.unit})` : ''}`} required>
              <Input
                type="number"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="Price per unit" required>
              <Input
                type="number"
                inputMode="numeric"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </Field>

            <Field label="Vendor">
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </Field>
            <Field label="Purchase date" required>
              <Input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </Field>

            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 sm:col-span-2">
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Also record it as an expense
                </span>
                <span className="block text-xs text-slate-500">
                  Files it under Groceries so the profit estimate stays accurate.
                </span>
              </span>
              <Switch checked={createExpense} onCheckedChange={setCreateExpense} />
            </label>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-600">Total</span>
            <span className="font-display text-lg font-semibold text-slate-900 tabular">
              {formatMoney(total)}
            </span>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={submit} disabled={!total}>
              Record purchase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
