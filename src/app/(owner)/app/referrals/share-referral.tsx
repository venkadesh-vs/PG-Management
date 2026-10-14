'use client'

import * as React from 'react'
import { Check, Copy, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

/** Copy the code or link, or send the invitation on WhatsApp. */
export function ShareReferral({ code, link, percent }: { code: string; link: string; percent: number }) {
  const toast = useToast()
  const [copied, setCopied] = React.useState<'code' | 'link' | null>(null)
  const message =
    `I use StayFlow to run my PG: rent, residents, food and electricity in one app. ` +
    `Try it free with my referral code ${code}: ${link}`

  async function copy(what: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(what === 'code' ? code : link)
      setCopied(what)
      toast.success(what === 'code' ? 'Code copied' : 'Link copied', `Share it with a PG owner. You get ${percent}% off a month when they pay.`)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast.error('Could not copy', 'Select it and copy it by hand.')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-xl border border-dashed border-blue-300 bg-white px-4 py-2 font-mono text-xl font-semibold tracking-widest text-slate-900">
          {code}
        </span>
        <Button variant="outline" size="sm" onClick={() => copy('code')}>
          {copied === 'code' ? <Check className="size-4" /> : <Copy className="size-4" />}
          Copy code
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{link}</span>
        <Button variant="ghost" size="sm" onClick={() => copy('link')} aria-label="Copy link">
          {copied === 'link' ? <Check className="size-4" /> : <Copy className="size-4" />}
          Copy link
        </Button>
      </div>
      <Button asChild variant="success" className="w-full sm:w-auto">
        <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
          <MessageCircle className="size-4" />
          Share on WhatsApp
        </a>
      </Button>
    </div>
  )
}
