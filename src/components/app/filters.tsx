'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { Input, Select } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * URL-driven list controls. Keeping search, filters, sort and page in the
 * query string means every list view is shareable, bookmarkable and works
 * with server-side rendering — no client cache to keep in step.
 */

function useParamWriter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return React.useCallback(
    (updates: Record<string, string | null>, opts?: { resetPage?: boolean }) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') params.delete(key)
        else params.set(key, value)
      }
      if (opts?.resetPage !== false) params.delete('page')
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )
}

export function SearchInput({
  placeholder = 'Search…',
  paramKey = 'q',
  className,
}: {
  placeholder?: string
  paramKey?: string
  className?: string
}) {
  const searchParams = useSearchParams()
  const write = useParamWriter()
  const [value, setValue] = React.useState(searchParams.get(paramKey) ?? '')

  // Keep the field in step when the URL changes from elsewhere (e.g. Clear).
  React.useEffect(() => {
    setValue(searchParams.get(paramKey) ?? '')
  }, [searchParams, paramKey])

  React.useEffect(() => {
    const current = searchParams.get(paramKey) ?? ''
    if (value === current) return
    const timer = setTimeout(() => write({ [paramKey]: value || null }), 300)
    return () => clearTimeout(timer)
  }, [value, paramKey, searchParams, write])

  return (
    <div className={cn('relative min-w-0 flex-1 sm:max-w-xs', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-8"
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

export function FilterSelect({
  paramKey,
  options,
  placeholder,
  className,
}: {
  paramKey: string
  options: { value: string; label: string }[]
  placeholder: string
  className?: string
}) {
  const searchParams = useSearchParams()
  const write = useParamWriter()
  const value = searchParams.get(paramKey) ?? ''

  return (
    <Select
      value={value}
      onChange={(e) => write({ [paramKey]: e.target.value || null })}
      className={cn('w-auto min-w-[9rem]', value && 'border-blue-300 bg-blue-50/50 text-blue-800', className)}
      aria-label={placeholder}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  )
}

export function FilterBar({
  children,
  activeCount = 0,
}: {
  children: React.ReactNode
  activeCount?: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function clearAll() {
    const params = new URLSearchParams()
    const property = searchParams.get('property')
    if (property) params.set('property', property)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5" />
          Clear filters
          <span className="ml-0.5 rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold">
            {activeCount}
          </span>
        </Button>
      )}
    </div>
  )
}

export function Pagination({
  page,
  pageSize,
  total,
  className,
}: {
  page: number
  pageSize: number
  total: number
  className?: string
}) {
  const write = useParamWriter()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <p className="text-xs text-slate-500">
        Showing <span className="font-semibold text-slate-700 tabular">{from}</span>–
        <span className="font-semibold text-slate-700 tabular">{to}</span> of{' '}
        <span className="font-semibold text-slate-700 tabular">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => write({ page: String(page - 1) }, { resetPage: false })}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="px-2 text-xs font-medium text-slate-600 tabular">
          {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page >= pages}
          onClick={() => write({ page: String(page + 1) }, { resetPage: false })}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

