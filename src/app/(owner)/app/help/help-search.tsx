'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronRight, Search } from 'lucide-react'
import { HELP_SECTIONS, searchHelp, type HelpArticle } from '@/lib/help-articles'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/feedback'

/** Instant search over the help articles, grouped by section. */
export function HelpSearch({ articles, supportHref }: { articles: HelpArticle[]; supportHref: string | null }) {
  const [query, setQuery] = React.useState('')
  const results = React.useMemo(() => searchHelp(query, articles), [query, articles])

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help — e.g. razorpay, late fee, import"
          className="pl-10"
          aria-label="Search help articles"
          autoComplete="off"
        />
      </div>

      {results.length === 0 ? (
        <EmptyState
          compact
          icon="search"
          title="No article matches"
          description={supportHref ? 'Try other words, or ask the StayFlow team directly.' : 'Try other words, or ask the PG owner.'}
          action={
            supportHref ? (
              <Link href={supportHref} className="text-sm font-medium text-blue-700 hover:underline">
                Contact support
              </Link>
            ) : undefined
          }
        />
      ) : (
        HELP_SECTIONS.map((section) => {
          const rows = results.filter((a) => a.section === section)
          if (!rows.length) return null
          return (
            <section key={section} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{section}</h2>
              <div className="grid gap-2 md:grid-cols-2">
                {rows.map((a) => (
                  <Link key={a.slug} href={`/app/help/${a.slug}`} className="block min-w-0">
                    <Card className="h-full transition-colors hover:border-slate-300">
                      <CardContent className="flex items-start gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900">{a.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{a.summary}</p>
                        </div>
                        <ChevronRight className="mt-0.5 size-4 shrink-0 text-slate-300" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
