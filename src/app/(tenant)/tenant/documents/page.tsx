import type { Metadata } from 'next'
import { BadgeCheck, Clock, FileText, FolderLock, IdCard } from 'lucide-react'
import { requireTenant } from '@/lib/auth'
import { getLookupLabels } from '@/server/services/org-defaults'
import { prisma } from '@/lib/prisma'
import { formatDate, maskId } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { Stagger, StaggerItem } from '@/components/motion/reveal'
import { IconTile, PhoneHeader } from '../_ui/phone-ui'

export const metadata: Metadata = { title: 'Documents' }

export default async function TenantDocumentsPage() {
  const user = await requireTenant()

  const resident = await prisma.resident.findUnique({
    where: { id: user.residentId },
    include: {
      documents: { orderBy: { uploadedAt: 'desc' } },
      property: { select: { name: true } },
    },
  })
  if (!resident) return null
  const idTypeLabels = await getLookupLabels(resident.organizationId, 'ID_TYPE')

  return (
    <div className="space-y-5">
      <PhoneHeader icon={FolderLock} title="Documents" subtitle="Your ID proofs and agreement." />

      {/* --------------------------------------------------- KYC status */}
      <Card
        className={
          resident.kycStatus === 'VERIFIED'
            ? 'border-emerald-200 bg-emerald-50/50'
            : 'border-amber-200 bg-amber-50/50'
        }
      >
        <CardContent className="flex items-start gap-3 p-5">
          <IconTile
            icon={resident.kycStatus === 'VERIFIED' ? BadgeCheck : Clock}
            tone={resident.kycStatus === 'VERIFIED' ? 'emerald' : 'amber'}
            size="lg"
            className="bg-white"
          />
          <div>
            <p
              className={`text-sm font-semibold ${
                resident.kycStatus === 'VERIFIED' ? 'text-emerald-900' : 'text-amber-900'
              }`}
            >
              {resident.kycStatus === 'VERIFIED'
                ? 'Your KYC is verified'
                : resident.kycStatus === 'PENDING'
                  ? 'KYC verification in progress'
                  : 'KYC not submitted yet'}
            </p>
            <p
              className={`mt-1 text-sm ${
                resident.kycStatus === 'VERIFIED' ? 'text-emerald-800/80' : 'text-amber-800/80'
              }`}
            >
              {resident.kycStatus === 'VERIFIED'
                ? `Verified on ${formatDate(resident.kycVerifiedAt)}.`
                : 'Hand your ID proof to the PG manager and they will verify it here.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {resident.idNumber && (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <IconTile icon={IdCard} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">
                {resident.idType ? (idTypeLabels[resident.idType] ?? resident.idType.replace('_', ' ')) : 'ID proof'}
              </p>
              <p className="font-mono text-xs text-slate-500">{maskId(resident.idNumber)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {resident.documents.length === 0 ? (
        <EmptyState
          icon="file"
          title="No documents on file"
          description="Documents your PG uploads during admission will be listed here."
        />
      ) : (
        <Stagger onView={false} className="space-y-2.5">
          {resident.documents.map((doc) => (
            <StaggerItem key={doc.id}>
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <IconTile icon={FileText} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{doc.label}</p>
                    <p className="text-xs capitalize text-slate-500">
                      {doc.kind.replace('_', ' ').toLowerCase()} · {formatDate(doc.uploadedAt)}
                    </p>
                  </div>
                  <Badge variant={doc.verified ? 'success' : 'warning'} size="sm">
                    {doc.verified ? 'Verified' : 'Pending'}
                  </Badge>
                </CardContent>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <p className="px-4 text-center text-xs leading-relaxed text-slate-400">
        This demo records documents without storing the files themselves. Ask your PG for a copy if
        you need one.
      </p>
    </div>
  )
}
