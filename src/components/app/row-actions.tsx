'use client'

import * as React from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown'
import { QuickForm, type QuickFormProps } from '@/components/app/quick-form'
import { ConfirmAction } from '@/components/app/confirm-action'

/**
 * The "⋯" menu on a list row: Edit (a QuickForm in PATCH mode, prefilled
 * through each field's defaultValue) and Delete (a confirm step). Props are
 * plain data so server pages can render it directly.
 */
export function RowActions({
  label,
  edit,
  remove,
}: {
  /** For the menu button's aria-label, e.g. "EB bill". */
  label: string
  edit?: Pick<QuickFormProps, 'title' | 'description' | 'fields' | 'endpoint' | 'successTitle' | 'submitLabel' | 'size'>
  remove?: {
    title: string
    description?: string
    endpoint: string
    confirmLabel?: string
    successTitle: string
    /** Shown instead of the delete action when deleting is not possible. */
    disabledReason?: string
  }
}) {
  const [dialog, setDialog] = React.useState<'edit' | 'delete' | null>(null)
  if (!edit && !remove) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {edit && (
            <DropdownMenuItem onSelect={() => setDialog('edit')}>
              <Pencil />
              Edit
            </DropdownMenuItem>
          )}
          {remove && (
            <DropdownMenuItem
              destructive
              disabled={Boolean(remove.disabledReason)}
              onSelect={() => setDialog('delete')}
            >
              <Trash2 />
              {remove.disabledReason ? `Delete (${remove.disabledReason})` : 'Delete'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {edit && (
        <QuickForm
          {...edit}
          method="PATCH"
          submitLabel={edit.submitLabel ?? 'Save changes'}
          open={dialog === 'edit'}
          onOpenChange={(open) => setDialog(open ? 'edit' : null)}
        />
      )}
      {remove && (
        <ConfirmAction
          open={dialog === 'delete'}
          onOpenChange={(open) => setDialog(open ? 'delete' : null)}
          title={remove.title}
          description={remove.description}
          endpoint={remove.endpoint}
          confirmLabel={remove.confirmLabel ?? 'Delete'}
          successTitle={remove.successTitle}
        />
      )}
    </>
  )
}
