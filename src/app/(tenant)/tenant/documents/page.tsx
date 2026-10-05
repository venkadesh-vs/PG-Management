import type { Metadata } from 'next'
import { BadgeCheck, Clock, FileText, IdCard } from 'lucide-react'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatDate, maskId } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'

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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">
          Documents
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">Your ID proofs and agreement.</p>
      </div>

      {/* --------------------------------------------------- KYC status */}
      <Card
        className={
          resident.kycStatus === 'VERIFIED'
            ? 'border-emerald-200 bg-emerald-50/50'
            : 'border-amber-200 bg-amber-50/50'
        }
      >
        <CardContent className="flex items-start gap-3 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
            {resident.kycStatus === 'VERIFIED' ? (
              <BadgeCheck className="size-5 text-emerald-600" />
            ) : (
              <Clock className="size-5 text-amber-600" />
            )}
          </div>
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
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
              <IdCard className="size-5 text-slate-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">
                {resident.idType?.replace('_', ' ') ?? 'ID proof'}
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
        <ul className="space-y-2">
          {resident.documents.map((doc) => (
            <li key={doc.id}>
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <FileText className="size-5 text-slate-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{doc.label}</p>
                    <p className="text-xs text-slate-500">
                      {doc.kind.replace('_', ' ').toLowerCase()} · {formatDate(doc.uploadedAt)}
                    </p>
                  </div>
                  <Badge variant={doc.verified ? 'success' : 'warning'} size="sm">
                    {doc.verified ? 'Verified' : 'Pending'}
                  </Badge>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-xs text-slate-400">
        This demo records documents without storing the files themselves. Ask your PG for a copy if
        you need one.
      </p>
    </div>
  )
}
