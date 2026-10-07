import { Download } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Job = {
  id: string
  kind: string
  kindLabel: string
  fileName: string | null
  status: string
  totalRows: number
  imported: number
  skipped: number
  failed: number
  createdBy: string | null
  createdAt: string
  finishedAt: string | null
}

const STATUS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
  PREVIEWED: { label: 'Checked only', variant: 'default' },
  IMPORTING: { label: 'Importing', variant: 'info' },
  COMPLETED: { label: 'Completed', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'danger' },
}

/** The last 20 imports with a link to each one's per-row results. */
export function ImportHistory({ jobs }: { jobs: Job[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Import history</CardTitle>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No imports yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {jobs.map((job) => {
              const status = STATUS[job.status] ?? STATUS.PREVIEWED
              const ran = job.status === 'COMPLETED' || job.status === 'FAILED'
              return (
                <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                      <span className="truncate">{job.fileName || 'Upload'}</span>
                      <Badge size="sm" variant="outline">{job.kindLabel}</Badge>
                      <Badge size="sm" variant={status.variant}>{status.label}</Badge>
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(job.createdAt)}
                      {job.createdBy ? ` · ${job.createdBy}` : ''} · {job.totalRows} rows
                      {ran && ` · Imported ${job.imported} · Skipped ${job.skipped} · Failed ${job.failed}`}
                    </p>
                  </div>
                  {ran && (
                    <a
                      href={`/api/imports/jobs?id=${job.id}`}
                      download
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                    >
                      <Download className="size-3.5" />
                      Results
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
