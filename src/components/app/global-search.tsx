'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Bed,
  Building2,
  CreditCard,
  Loader2,
  Receipt,
  Search,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, qs } from '@/lib/client'
import { cn } from '@/lib/utils'

export type SearchResult = {
  id: string
  type: 'resident' | 'property' | 'room' | 'bed' | 'payment' | 'complaint' | 'staff' | 'expense' | 'organization'
  title: string
  subtitle: string
  href: string
  meta?: string
}

const TYPE_META: Record<SearchResult['type'], { icon: React.ElementType; label: string; tone: string }> =
  {
    resident: { icon: UserRound, label: 'Resident', tone: 'bg-blue-50 text-blue-600' },
    property: { icon: Building2, label: 'PG', tone: 'bg-violet-50 text-violet-600' },
    organization: { icon: Building2, label: 'Organization', tone: 'bg-violet-50 text-violet-600' },
    room: { icon: Bed, label: 'Room', tone: 'bg-slate-100 text-slate-600' },
    bed: { icon: Bed, label: 'Bed', tone: 'bg-slate-100 text-slate-600' },
    payment: { icon: CreditCard, label: 'Payment', tone: 'bg-emerald-50 text-emerald-600' },
    complaint: { icon: Wrench, label: 'Complaint', tone: 'bg-amber-50 text-amber-600' },
    staff: { icon: Users, label: 'Staff', tone: 'bg-sky-50 text-sky-600' },
    expense: { icon: Receipt, label: 'Expense', tone: 'bg-pink-50 text-pink-600' },
  }

/**
 * Cross-module search. Debounced, keyboard-navigable, and scoped server-side
 * to the signed-in user's organization.
 */
export function GlobalSearch({
  open,
  onOpenChange,
  scope = 'org',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope?: 'org' | 'platform'
}) {
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [loading, setLoading] = React.useState(false)
  const [cursor, setCursor] = React.useState(0)

  React.useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setCursor(0)
    }
  }, [open])

  React.useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const data = await api.get<{ results: SearchResult[] }>(
          `/api/search${qs({ q: query.trim(), scope })}`,
        )
        setResults(data.results)
        setCursor(0)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 220)
    return () => clearTimeout(timer)
  }, [query, scope])

  function go(result: SearchResult) {
    onOpenChange(false)
    router.push(result.href)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && results[cursor]) {
      e.preventDefault()
      go(results[cursor])
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" hideClose className="top-[12%] translate-y-0 gap-0 p-0">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          {loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-slate-400" />
          ) : (
            <Search className="size-4 shrink-0 text-slate-400" />
          )}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search residents, rooms, payments, complaints…"
            className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[10px] text-slate-400 sm:block">
            ESC
          </kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2 scrollbar-slim">
          {query.trim().length < 2 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-slate-500">Type at least two characters to search.</p>
              <p className="mt-1 text-xs text-slate-400">
                Residents · PGs · Rooms & beds · Payments · Complaints · Staff · Expenses
              </p>
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm font-medium text-slate-700">No matches for “{query}”</p>
              <p className="mt-1 text-xs text-slate-500">Try a name, room number or receipt number.</p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {results.map((result, i) => {
                const meta = TYPE_META[result.type]
                const Icon = meta.icon
                return (
                  <li key={`${result.type}-${result.id}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(result)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                        i === cursor ? 'bg-slate-100' : 'hover:bg-slate-50',
                      )}
                    >
                      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', meta.tone)}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {result.title}
                        </span>
                        <span className="block truncate text-xs text-slate-500">{result.subtitle}</span>
                      </span>
                      {result.meta && (
                        <span className="shrink-0 text-xs font-medium text-slate-500 tabular">
                          {result.meta}
                        </span>
                      )}
                      <span className="hidden shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:block">
                        {meta.label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
