'use client'

import * as React from 'react'
import { QuickForm, type QuickField } from '@/components/app/quick-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InviteLinkPanel, type AccessLink } from '@/components/app/invite-link'

/**
 * "Add staff" with the worker-app invite shown afterwards: who it was sent
 * to and the link to copy if WhatsApp/email did not reach them.
 */
export function AddStaffButton({ fields }: { fields: QuickField[] }) {
  const [login, setLogin] = React.useState<{ name: string; link: AccessLink } | null>(null)

  return (
    <>
      <QuickForm
        trigger="Add staff"
        title="Add a staff member"
        description="Give them a login and they get the worker app — a simple task list, nothing else. We send them a link to set their own password."
        endpoint="/api/operations"
        payload={{ entity: 'STAFF' }}
        successTitle="Staff member added"
        submitLabel="Add staff"
        fields={fields}
        onSuccess={(result) => {
          const link = result.login as AccessLink | null | undefined
          const staff = result.staff as { name?: string } | undefined
          if (link) setLogin({ name: staff?.name ?? 'Staff member', link })
        }}
      />
      <Dialog open={Boolean(login)} onOpenChange={(open) => !open && setLogin(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Worker app login for {login?.name}</DialogTitle>
            <DialogDescription>
              No password to hand over — they choose their own from the link.
            </DialogDescription>
          </DialogHeader>
          {login && <InviteLinkPanel link={login.link} title="Invite link" />}
          <DialogFooter>
            <Button type="button" variant="primary" onClick={() => setLogin(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
