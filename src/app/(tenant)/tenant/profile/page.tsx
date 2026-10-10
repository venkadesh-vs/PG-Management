import type { Metadata } from 'next'
import {
  Bed,
  Briefcase,
  Building2,
  CalendarDays,
  Home,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
  Utensils,
  Wallet,
} from 'lucide-react'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { cn, formatDate, formatMoney, formatPhone, initials } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/primitives'
import { getLookup } from '@/server/services/org-defaults'
import { EditProfile } from './edit-profile'

export const metadata: Metadata = { title: 'Profile' }

export default async function TenantProfilePage() {
  const user = await requireTenant()

  const resident = await prisma.resident.findUnique({
    where: { id: user.residentId },
    include: {
      property: true,
      room: true,
      bed: true,
      deposit: true,
      foodSubscription: { include: { foodPlan: true } },
    },
  })
  if (!resident) return null
  const relations = await getLookup(resident.organizationId, 'GUARDIAN_RELATION')
  const relationLabel = relations.find((r) => r.value === resident.guardianRelation)?.label ?? resident.guardianRelation
  const address = [resident.permanentAddress, resident.city, resident.state, resident.pincode].filter(Boolean).join(', ')
  const work = [resident.designation, resident.companyName].filter(Boolean).join(' · ')

  return (
    <div className="space-y-5">
      {/* --------------------------------------------------------- Header */}
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 to-blue-600 p-5 text-white shadow-sm ring-1 ring-blue-900/10',
        )}
      >
        <div className="dot-grid absolute inset-0 opacity-[0.12]" />
        <div className="relative flex items-center gap-4">
          <Avatar className="size-16 border-2 border-white/30">
            <AvatarFallback className="bg-white/15 text-lg font-semibold text-white">
              {initials(resident.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-semibold tracking-tight">
              {resident.fullName}
            </h1>
            <p className="text-sm text-white/75">{resident.code}</p>
            {resident.kycStatus === 'VERIFIED' && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/15 px-2 py-0.5 text-[11px] font-medium backdrop-blur">
                <ShieldCheck className="size-3" />
                KYC verified
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------- Stay */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-sm font-semibold text-slate-900">Your stay</p>
          <Row icon={Building2} label="PG" value={resident.property.name} />
          <Row
            icon={Bed}
            label="Room & bed"
            value={
              resident.room
                ? `Room ${resident.room.number}${resident.bed ? ` · Bed ${resident.bed.label}` : ''}`
                : 'Not allocated'
            }
          />
          <Row icon={CalendarDays} label="Joined" value={formatDate(resident.joiningDate)} />
          <Row icon={Wallet} label="Monthly rent" value={formatMoney(resident.rentAmount)} />
          {resident.maintenanceFee > 0 && (
            <Row icon={Wallet} label="Maintenance" value={formatMoney(resident.maintenanceFee)} />
          )}
          {user.modules.includes('food') && (
            <Row
              icon={Utensils}
              label="Food plan"
              value={
                resident.foodSubscription?.active
                  ? `${resident.foodSubscription.foodPlan.name} · ${formatMoney(resident.foodCharge)}`
                  : 'Not subscribed'
              }
            />
          )}
          <Row
            icon={ShieldCheck}
            label="Security deposit"
            value={`${formatMoney(resident.deposit?.collected ?? 0)} held`}
          />
        </CardContent>
      </Card>

      {/* -------------------------------------------------------- Contact */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">Your details</p>
            <EditProfile
              relations={
                resident.guardianRelation && !relations.some((r) => r.value === resident.guardianRelation)
                  ? [...relations, { value: resident.guardianRelation, label: resident.guardianRelation }]
                  : relations
              }
              initial={{
                phone: resident.phone,
                whatsappPhone: resident.whatsappPhone && resident.whatsappPhone !== resident.phone ? resident.whatsappPhone : '',
                email: resident.email ?? '',
                bloodGroup: resident.bloodGroup ?? '',
                guardianName: resident.guardianName ?? '',
                guardianRelation: resident.guardianRelation ?? '',
                guardianPhone: resident.guardianPhone ?? '',
                permanentAddress: resident.permanentAddress ?? '',
                city: resident.city ?? '',
                state: resident.state ?? '',
                pincode: resident.pincode ?? '',
                occupationType: resident.occupationType ?? '',
                companyName: resident.companyName ?? '',
                designation: resident.designation ?? '',
              }}
            />
          </div>
          <Row icon={Phone} label="Mobile" value={formatPhone(resident.phone)} />
          {resident.email && <Row icon={Mail} label="Email" value={resident.email} />}
          {resident.guardianName && (
            <Row
              icon={UserRound}
              label={relationLabel ? `Emergency contact (${relationLabel})` : 'Emergency contact'}
              value={`${resident.guardianName}${
                resident.guardianPhone ? ` · ${formatPhone(resident.guardianPhone)}` : ''
              }`}
            />
          )}
          {address && <Row icon={Home} label="Home address" value={address} />}
          {work && <Row icon={Briefcase} label={resident.occupationType === 'STUDENT' ? 'College' : 'Work'} value={work} />}
          {resident.bloodGroup && (
            <Row icon={ShieldCheck} label="Blood group" value={resident.bloodGroup} />
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------ PG contact */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-sm font-semibold text-slate-900">
            Your PG
          </p>
          <p className="text-sm text-slate-700">
            {resident.property.addressLine}, {resident.property.city}, {resident.property.state}{' '}
            {resident.property.pincode}
          </p>
          {resident.property.contactPhone && (
            <a
              href={`tel:${resident.property.contactPhone}`}
              className="flex items-center gap-2 text-sm font-medium text-blue-600"
            >
              <Phone className="size-4" />
              {formatPhone(resident.property.contactPhone)}
              {resident.property.contactName ? ` · ${resident.property.contactName}` : ''}
            </a>
          )}

          {resident.property.rules.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 text-sm font-semibold text-slate-900">
                House rules
              </p>
              <ul className="space-y-1">
                {resident.property.rules.map((rule) => (
                  <li key={rule} className="text-sm text-slate-600">
                    · {rule}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {resident.property.amenities.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 text-sm font-semibold text-slate-900">
                Amenities
              </p>
              <div className="flex flex-wrap gap-1.5">
                {resident.property.amenities.map((amenity) => (
                  <Badge key={amenity} variant="outline" size="sm">
                    {amenity}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  )
}
