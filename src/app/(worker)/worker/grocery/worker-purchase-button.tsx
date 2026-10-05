'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, ShoppingCart } from 'lucide-react'
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
import { Field, Input } from '@/components/ui/input'

/**
 * A worker records what they actually bought. Stock and the expense update
 * together, so nobody has to re-enter it for the owner.
 */
export function WorkerPurchaseButton({
  propertyId,
  item,
}: {
  propertyId: string
  item: {
    id: string
    name: string
    unit: string
    suggestedQuantity: number
    lastPrice: number
  }
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [quantity, setQuantity] = React.useState(String(Math.max(1, item.suggestedQuantity)))
  const [unitPrice, setUnitPrice] = React.useState(String(item.lastPrice))
  const [vendor, setVendor] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const total = (Number(quantity) || 0) * (Number(unitPrice) || 0)

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/operations', {
        entity: 'PURCHASE',
        propertyId,
        groceryItemId: item.id,
        quantity: Number(quantity),
        unitPrice: Number(unitPrice),
        vendor: vendor || undefined,
        purchaseDate: toISODate(new Date()),
        createExpense: true,
      })
      toast.success('Purchase recorded', result.message)
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to record',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={`Record a purchase of ${item.name}`}
      >
        <ShoppingCart className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Bought {item.name}?</DialogTitle>
            <DialogDescription>
              Stock goes up and the expense is filed against the PG automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Quantity (${item.unit})`} required>
              <Input
                type="number"
                inputMode="numeric"
                autoFocus
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
          </div>
          <Field label="Shop / vendor">
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </Field>

          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-600">Total paid</span>
            <span className="font-display text-lg font-semibold text-slate-900 tabular">
              {formatMoney(total)}
            </span>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="success" loading={busy} onClick={submit} disabled={!total}>
              <Check className="size-4" />
              Record purchase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
