import { CardSkeleton, Skeleton } from '@/components/ui/feedback'

/** Shown instantly while a phone-app page's data loads. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-32 w-full rounded-3xl" />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  )
}
