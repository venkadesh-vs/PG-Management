import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, Lightbulb } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { HELP_ARTICLES, helpArticle } from '@/lib/help-articles'
import { canUseSupport } from '@/server/services/support'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent } from '@/components/ui/card'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  return { title: helpArticle(slug)?.title ?? 'Help' }
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireOrgUser()
  const { slug } = await params
  const article = helpArticle(slug)
  if (!article) notFound()
  const related = HELP_ARTICLES.filter((a) => a.section === article.section && a.slug !== article.slug).slice(0, 3)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={article.title}
        subtitle={article.summary}
        icon="book"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Help', href: '/app/help' },
          { label: article.section },
        ]}
      />
      <Card>
        <CardContent className="space-y-4 p-5 text-sm leading-relaxed text-slate-700">
          {article.body.map((block, i) =>
            block.type === 'p' ? (
              <p key={i}>{block.text}</p>
            ) : block.type === 'steps' ? (
              <ol key={i} className="space-y-2.5">
                {block.items.map((item, n) => (
                  <li key={n} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                      {n + 1}
                    </span>
                    <span className="min-w-0 pt-0.5">{item}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p key={i} className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <Lightbulb className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">{block.text}</span>
              </p>
            ),
          )}
        </CardContent>
      </Card>

      {article.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {article.links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              {l.label}
              <ArrowRight className="size-3.5" />
            </Link>
          ))}
        </div>
      )}

      {related.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Related</h2>
          <ul className="space-y-1">
            {related.map((a) => (
              <li key={a.slug}>
                <Link href={`/app/help/${a.slug}`} className="text-sm text-blue-700 hover:underline">
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Still stuck?{' '}
        {canUseSupport(user) ? (
          <Link
            href={`/app/support?new=1&subject=${encodeURIComponent(`Help with: ${article.title}`)}`}
            className="font-medium text-blue-700 hover:underline"
          >
            Open a support ticket
          </Link>
        ) : (
          'Ask the PG owner to open a support ticket'
        )}{' '}
        and the StayFlow team will help.
      </p>
    </div>
  )
}
