'use client'

import * as React from 'react'
import Link from 'next/link'
import { Archive, ArchiveRestore, MoreHorizontal, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown'
import { ConfirmAction } from '@/components/app/confirm-action'

/**
 * Header actions on a PG: edit, archive, restore. What shows depends on the
 * person's permissions (properties.manage to edit, properties.create to
 * archive/restore), worked out on the server and passed in.
 */
export function PropertyActions({
  property,
  canEdit,
  canArchive,
  activeResidents,
  openBookings,
  periodEnd,
}: {
  property: { id: string; name: string; archived: boolean }
  canEdit: boolean
  canArchive: boolean
  activeResidents: number
  openBookings: number
  /** End of the subscription period already billed, if any (formatted). */
  periodEnd: string | null
}) {
  const [dialog, setDialog] = React.useState<'archive' | 'restore' | null>(null)

  if (property.archived) {
    if (!canArchive) return null
    return (
      <>
        <Button variant="primary" onClick={() => setDialog('restore')}>
          <ArchiveRestore className="size-4" />
          Restore PG
        </Button>
        <ConfirmAction
          open={dialog === 'restore'}
          onOpenChange={(open) => setDialog(open ? 'restore' : null)}
          title={`Restore ${property.name}?`}
          description="The PG comes back on the dashboard, bed map and reports, and its StayFlow subscription billing resumes."
          endpoint={`/api/properties/${property.id}`}
          method="POST"
          body={{ action: 'RESTORE' }}
          confirmLabel="Restore PG"
          successTitle="PG restored"
          tone="default"
        />
      </>
    )
  }

  if (!canEdit && !canArchive) return null

  return (
    <>
      {canEdit && (
        <Button variant="outline" asChild>
          <Link href={`/app/properties/${property.id}/edit`}>
            <Pencil className="size-4" />
            Edit
          </Link>
        </Button>
      )}
      {canArchive && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More PG actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem destructive onSelect={() => setDialog('archive')}>
              <Archive />
              Archive PG
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ConfirmAction
        open={dialog === 'archive'}
        onOpenChange={(open) => setDialog(open ? 'archive' : null)}
        title={`Archive ${property.name}?`}
        description={
          activeResidents > 0
            ? `${activeResidents} resident${activeResidents === 1 ? ' is' : 's are'} still active, on notice or pending here. Check them out first — archiving will be refused until then.`
            : openBookings > 0
              ? `${openBookings} booking${openBookings === 1 ? ' is' : 's are'} still open here. Check them in or cancel them first — archiving will be refused until then.`
              : `The PG is hidden from the dashboard and lists. Its StayFlow subscription is cancelled at the end of the current period${periodEnd ? ` (${periodEnd})` : ''} and is not billed again. Its history stays on file and you can restore it later.`
        }
        endpoint={`/api/properties/${property.id}`}
        method="DELETE"
        confirmLabel="Archive PG"
        successTitle="PG archived"
      />
    </>
  )
}
