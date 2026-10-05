'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/primitives'

type Feature = {
  id: string
  key: string
  name: string
  description: string | null
  enabled: boolean
  plans: string[]
}

/**
 * Toggling a feature off hides it everywhere, for everyone — so the switch
 * reports what actually changed rather than only flipping the UI.
 */
export function FeatureToggles({
  features,
  plans,
}: {
  features: Feature[]
  plans: { slug: string; name: string }[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [items, setItems] = React.useState(features)
  const [busy, setBusy] = React.useState<string | null>(null)

  React.useEffect(() => setItems(features), [features])

  async function toggle(feature: Feature, enabled: boolean) {
    setBusy(feature.id)
    setItems((current) =>
      current.map((f) => (f.id === feature.id ? { ...f, enabled } : f)),
    )
    try {
      await api.post('/api/admin/features', { featureId: feature.id, enabled })
      toast.success(
        enabled ? `${feature.name} enabled` : `${feature.name} disabled`,
        enabled
          ? 'Available to every plan that includes it.'
          : 'Hidden for all accounts until it is switched back on.',
      )
      router.refresh()
    } catch (error) {
      setItems((current) =>
        current.map((f) => (f.id === feature.id ? { ...f, enabled: !enabled } : f)),
      )
      toast.error(
        'Unable to change this',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((feature) => (
        <motion.div key={feature.id} layout>
          <Card className={cn(!feature.enabled && 'bg-slate-50/70')}>
            <CardContent className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm font-semibold',
                    feature.enabled ? 'text-slate-900' : 'text-slate-500',
                  )}
                >
                  {feature.name}
                </p>
                <p className="font-mono text-[11px] text-slate-400">{feature.key}</p>
                {feature.description && (
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {feature.description}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {feature.plans.length === 0 ? (
                    <span className="text-[11px] text-slate-400">Not on any plan</span>
                  ) : (
                    feature.plans.map((slug) => (
                      <Badge key={slug} variant="outline" size="sm">
                        {plans.find((p) => p.slug === slug)?.name ?? slug}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              <Switch
                checked={feature.enabled}
                disabled={busy === feature.id}
                onCheckedChange={(checked) => toggle(feature, checked)}
                aria-label={`Toggle ${feature.name}`}
              />
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  )
}
