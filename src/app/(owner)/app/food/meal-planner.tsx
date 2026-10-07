'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Check, ChevronLeft, ChevronRight, CookingPot, Pencil } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, toISODate } from '@/lib/utils'
import { PROPERTY_THEMES } from '@/lib/theme'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Textarea } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type MealRow = {
  type: 'BREAKFAST' | 'LUNCH' | 'DINNER'
  mealId: string | null
  menu: string
  expected: number
  actual: number | null
}

type BoardEntry = {
  propertyId: string
  propertyName: string
  propertyType: 'MENS' | 'WOMENS' | 'COLIVE'
  rows: MealRow[]
}

const MEAL_LABEL = { BREAKFAST: 'Breakfast', LUNCH: 'Lunch', DINNER: 'Dinner' } as const
const MEAL_TIME = { BREAKFAST: '7:30 – 9:30 AM', LUNCH: '12:30 – 2:30 PM', DINNER: '8:00 – 10:00 PM' } as const

/**
 * The kitchen board. Expected counts are derived, so the only thing anyone
 * types is the menu and — at the end of service — how many actually ate.
 */
export function MealPlanner({
  date,
  board,
  canManage = true,
}: {
  date: string
  board: BoardEntry[]
  /** food.manage — set menus and mark meals served. */
  canManage?: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [editing, setEditing] = React.useState<{
    entry: BoardEntry
    row: MealRow
    mode: 'menu' | 'served'
  } | null>(null)

  function shiftDate(days: number) {
    const next = new Date(date)
    next.setDate(next.getDate() + days)
    const params = new URLSearchParams(searchParams.toString())
    params.set('date', toISODate(next))
    router.push(`/app/food?${params.toString()}`)
  }

  const isToday = date === toISODate(new Date())

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => shiftDate(-1)} aria-label="Previous day">
            <ChevronLeft className="size-4" />
          </Button>
          <div className="min-w-[150px] text-center">
            <p className="font-display text-sm font-semibold text-slate-900">{formatDate(date)}</p>
            <p className="text-[11px] text-slate-500">
              {isToday ? 'Today' : new Date(date).toLocaleDateString('en-IN', { weekday: 'long' })}
            </p>
          </div>
          <Button variant="outline" size="icon-sm" onClick={() => shiftDate(1)} aria-label="Next day">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {!isToday && (
          <Button variant="ghost" size="sm" onClick={() => router.push('/app/food')}>
            Back to today
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {board.map((entry) => {
          const theme = PROPERTY_THEMES[entry.propertyType]
          const total = entry.rows.reduce((s, r) => s + r.expected, 0)
          return (
            <Card key={entry.propertyId} className="overflow-hidden">
              <div className={cn('h-1', theme.bgSolid)} />
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-sm">{entry.propertyName}</CardTitle>
                <span className="text-xs text-slate-500">
                  {total} meals expected today
                </span>
              </CardHeader>
              <CardContent className="space-y-2">
                {entry.rows.map((row) => (
                  <motion.div
                    key={row.type}
                    layout
                    className="rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-800">
                            {MEAL_LABEL[row.type]}
                          </p>
                          <span className="text-[11px] text-slate-400">{MEAL_TIME[row.type]}</span>
                        </div>
                        <p
                          className={cn(
                            'mt-0.5 truncate text-xs',
                            row.menu ? 'text-slate-600' : 'italic text-slate-400',
                          )}
                        >
                          {row.menu || 'Menu not set'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={cn('font-display text-xl font-semibold tabular', theme.text)}>
                          {row.actual ?? row.expected}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {row.actual !== null ? 'Served' : 'Expected'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 flex gap-2">
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing({ entry, row, mode: 'menu' })}
                        >
                          <Pencil className="size-3" />
                          {row.menu ? 'Edit menu' : 'Set menu'}
                        </Button>
                      )}
                      {canManage && row.mealId && row.actual === null && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing({ entry, row, mode: 'served' })}
                        >
                          <CookingPot className="size-3" />
                          Mark served
                        </Button>
                      )}
                      {row.actual !== null && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <Check className="size-3" />
                          Served
                        </span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {editing && (
        <MealDialog
          date={date}
          entry={editing.entry}
          row={editing.row}
          mode={editing.mode}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            router.refresh()
          }}
          toast={toast}
        />
      )}
    </div>
  )
}

function MealDialog({
  date,
  entry,
  row,
  mode,
  onClose,
  onSaved,
  toast,
}: {
  date: string
  entry: BoardEntry
  row: MealRow
  mode: 'menu' | 'served'
  onClose: () => void
  onSaved: () => void
  toast: ReturnType<typeof useToast>
}) {
  const [menu, setMenu] = React.useState(row.menu)
  const [count, setCount] = React.useState(String(row.expected))
  const [busy, setBusy] = React.useState(false)

  async function save() {
    setBusy(true)
    try {
      if (mode === 'menu') {
        const result = await api.post<{ message: string }>('/api/operations', {
          entity: 'MEAL',
          propertyId: entry.propertyId,
          date,
          type: row.type,
          menu,
        })
        toast.success('Menu saved', result.message)
      } else {
        const result = await api.post<{ message: string }>('/api/operations', {
          entity: 'MEAL_SERVED',
          mealId: row.mealId,
          actualCount: Number(count),
        })
        toast.success('Meal recorded', result.message)
      }
      onSaved()
    } catch (error) {
      toast.error(
        'Something went wrong',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {mode === 'menu' ? `${MEAL_LABEL[row.type]} menu` : `Mark ${MEAL_LABEL[row.type].toLowerCase()} served`}
          </DialogTitle>
          <DialogDescription>
            {entry.propertyName} · {formatDate(date)}
            {mode === 'served' && ` · ${row.expected} expected`}
          </DialogDescription>
        </DialogHeader>

        {mode === 'menu' ? (
          <Field label="What is being served?" required>
            <Textarea
              rows={3}
              autoFocus
              value={menu}
              onChange={(e) => setMenu(e.target.value)}
              placeholder="Idli, sambar, coconut chutney + boiled egg"
            />
          </Field>
        ) : (
          <>
            <Field label="How many meals were served?" required>
              <Input
                type="number"
                inputMode="numeric"
                autoFocus
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </Field>
            <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800">
              Recording the count deducts grocery stock using each item&apos;s configured
              per-resident quantity, and raises a low-stock alert where needed.
            </p>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={mode === 'menu' && !menu.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
