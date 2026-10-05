import { Skeleton, StatGridSkeleton, TableSkeleton } from '@/components/ui/feedback'

/** Shown instantly while a dashboard page's data loads. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-56" />
      </div>
      <StatGridSkeleton />
      <TableSkeleton />
    </div>
  )
}
