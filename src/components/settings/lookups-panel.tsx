'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, ListChecks, Pencil, Plus, Trash2, X } from 'lucide-react'
import { api } from '@/lib/client'
import { cn } from '@/lib/utils'
import { LOOKUP_TYPES } from '@/lib/permission-catalog'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/feedback'
import { EXPENSE_LOOKUP, type LookupItem } from './shared'

const LISTS = [
  ...LOOKUP_TYPES.map((t) => ({ type: t.type, label: t.label, description: t.description })),
  { type: EXPENSE_LOOKUP, label: 'Expense categories', description: 'How spending is grouped on the Expenses page and in reports.' },
]

type Res = { type: string; items: LookupItem[]; message?: string }

export function LookupsPanel({ canManage }: { canManage: boolean }) {
  const toast = useToast()
  const [type, setType] = React.useState(LISTS[0]!.type)
  const [items, setItems] = React.useState<LookupItem[] | null>(null)
  const [adding, setAdding] = React.useState('')
  const [editId, setEditId] = React.useState<string | null>(null)
  const [editLabel, setEditLabel] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const list = LISTS.find((l) => l.type === type)!
  const expense = type === EXPENSE_LOOKUP

  React.useEffect(() => {
    let live = true
    setItems(null)
    setEditId(null)
    api
      .get<Res>(`/api/lookups?type=${encodeURIComponent(type)}`)
      .then((res) => live && setItems(res.items))
      .catch((error) => {
        if (!live) return
        setItems([])
        toast.fromError(error, 'load the list')
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  async function send(body: Record<string, unknown>, success?: string) {
    setBusy(true)
    try {
      const res = await api.post<Res>('/api/lookups', { type, ...body })
      setItems(res.items)
      if (success) toast.success(success)
      return true
    } catch (error) {
      toast.fromError(error, 'update the list')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const label = adding.trim()
    if (!label) return
    if (await send({ action: 'CREATE', label }, `“${label}” added`)) setAdding('')
  }

  async function rename(item: LookupItem) {
    const label = editLabel.trim()
    if (!label || label === item.label) {
      setEditId(null)
      return
    }
    if (await send({ action: 'UPDATE', id: item.id, label }, 'Renamed — old records show the new name too')) setEditId(null)
  }

  function move(index: number, delta: number) {
    if (!items) return
    const next = [...items]
    const [row] = next.splice(index, 1)
    next.splice(index + delta, 0, row!)
    setItems(next) // optimistic
    send({ action: 'REORDER', ids: next.map((i) => i.id) })
  }

  return (
    <div className="grid gap-4 md:grid-cols-[240px_1fr]">
      {/* Phone: a picker. Wider: a list. */}
      <div className="md:hidden">
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Choose a list">
          {LISTS.map((l) => (
            <option key={l.type} value={l.type}>
              {l.label}
            </option>
          ))}
        </Select>
      </div>
      <nav className="hidden space-y-1 md:block">
        {LISTS.map((l) => (
          <button
            key={l.type}
            type="button"
            onClick={() => setType(l.type)}
            className={cn(
              'relative w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors',
              type === l.type ? 'text-blue-700' : 'text-slate-600 hover:bg-slate-50',
            )}
          >
            {type === l.type && (
              <motion.span layoutId="lookup-active" className="absolute inset-0 rounded-xl border border-blue-200 bg-blue-50" />
            )}
            <span className="relative">{l.label}</span>
          </button>
        ))}
      </nav>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ListChecks className="size-4 text-slate-400" />
              {list.label}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{list.description}</p>
            <p className="mt-1 text-xs text-slate-400">
              {expense
                ? 'Rename any time. A category can be removed only while no expense uses it.'
                : 'Renaming changes the label everywhere, including old records. Hidden options stay on old records but can’t be picked for new ones.'}
            </p>
          </div>

          {canManage && (
            <form onSubmit={add} className="flex gap-2">
              <Input value={adding} maxLength={60} placeholder="Add an option…" onChange={(e) => setAdding(e.target.value)} />
              <Button type="submit" variant="primary" disabled={!adding.trim() || busy}>
                <Plus className="size-4" />
                Add
              </Button>
            </form>
          )}

          {items === null ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-11 w-full rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              Nothing here yet — add your first option above.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((item, index) => (
                <motion.li
                  key={item.id}
                  layout
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2',
                    !item.active && 'bg-slate-50',
                  )}
                >
                  {editId === item.id ? (
                    <form
                      className="flex flex-1 items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        rename(item)
                      }}
                    >
                      <Input autoFocus value={editLabel} maxLength={60} onChange={(e) => setEditLabel(e.target.value)} className="h-9" />
                      <Button type="submit" size="icon-sm" variant="primary" aria-label="Save" loading={busy}>
                        {!busy && <Check className="size-3.5" />}
                      </Button>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setEditId(null)}>
                        <X className="size-3.5" />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <span className={cn('min-w-0 flex-1 truncate text-sm', item.active ? 'text-slate-800' : 'text-slate-400 line-through')}>
                        {item.label}
                      </span>
                      {!item.active && <Badge size="sm">Hidden</Badge>}
                      {expense && item.usage ? (
                        <span className="hidden text-xs text-slate-400 sm:inline">{item.usage} used</span>
                      ) : null}
                      {canManage && (
                        <div className="flex shrink-0 items-center">
                          {!expense && (
                            <>
                              <Button type="button" size="icon-sm" variant="ghost" aria-label="Move up" disabled={index === 0 || busy} onClick={() => move(index, -1)}>
                                <ArrowUp className="size-3.5" />
                              </Button>
                              <Button type="button" size="icon-sm" variant="ghost" aria-label="Move down" disabled={index === items.length - 1 || busy} onClick={() => move(index, 1)}>
                                <ArrowDown className="size-3.5" />
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Rename"
                            onClick={() => {
                              setEditId(item.id)
                              setEditLabel(item.label)
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          {expense ? (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Remove"
                              disabled={busy || Boolean(item.usage)}
                              title={item.usage ? 'In use — rename it instead' : 'Remove'}
                              onClick={() => send({ action: 'DELETE', id: item.id }, `“${item.label}” removed`)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label={item.active ? 'Hide' : 'Show again'}
                              title={item.active ? 'Hide from new records' : 'Show again'}
                              disabled={busy}
                              onClick={() =>
                                send(
                                  { action: 'SET_ACTIVE', id: item.id, active: !item.active },
                                  item.active ? `“${item.label}” hidden — old records keep it` : `“${item.label}” is back`,
                                )
                              }
                            >
                              {item.active ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                            </Button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </motion.li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
