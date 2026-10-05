import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertPropertyAccess, ValidationError } from '@/lib/tenancy'
import { checkInSchema } from '@/lib/validation'
import { checkInResident } from '@/server/services/residents'

/** POST /api/residents — the full digital admission + check-in. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, checkInSchema)
    await assertPropertyAccess(user, body.propertyId)

    const result = await checkInResident({
      organizationId: user.organizationId!,
      propertyId: body.propertyId,
      bedId: body.bedId,
      fullName: body.fullName,
      phone: body.phone,
      whatsappPhone: body.whatsappPhone || undefined,
      email: body.email || undefined,
      photoUrl: body.photoUrl || undefined,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
      gender: body.gender || undefined,
      bloodGroup: body.bloodGroup || undefined,
      qualification: body.qualification || undefined,
      permanentAddress: body.permanentAddress || undefined,
      city: body.city || undefined,
      state: body.state || undefined,
      pincode: body.pincode || undefined,
      guardianName: body.guardianName || undefined,
      guardianRelation: body.guardianRelation || undefined,
      guardianPhone: body.guardianPhone || undefined,
      guardianAddress: body.guardianAddress || undefined,
      occupationType: body.occupationType,
      companyName: body.companyName || undefined,
      companyAddress: body.companyAddress || undefined,
      designation: body.designation || undefined,
      idType: body.idType || undefined,
      idNumber: body.idNumber || undefined,
      joiningDate: new Date(body.joiningDate),
      rentAmount: body.rentAmount,
      depositAmount: body.depositAmount,
      maintenanceFee: body.maintenanceFee,
      foodOptIn: body.foodOptIn,
      foodCharge: body.foodOptIn ? body.foodCharge : 0,
      foodPlanId: body.foodPlanId || null,
      rentDueDay: body.rentDueDay,
      discountAmount: body.discountAmount,
      discountNote: body.discountNote || undefined,
      notes: body.notes || undefined,
      signatureUrl: body.signatureUrl || undefined,
      depositCollected: body.depositCollected,
      createTenantAccount: body.createTenantAccount,
      documents: body.documents,
      actor: { id: user.id, name: user.name },
    })

    return ok(
      {
        resident: {
          id: result.resident.id,
          code: result.resident.code,
          fullName: result.resident.fullName,
        },
        bed: { label: result.bed.label, room: result.bed.room.number },
        invoice: result.firstInvoice
          ? { number: result.firstInvoice.number, total: result.firstInvoice.total }
          : null,
        tenantLogin: result.tenantEmail
          ? { email: result.tenantEmail, password: result.tenantPassword }
          : null,
      },
      { status: 201 },
    )
  },
  { roles: ['OWNER', 'MANAGER'] },
)

/** GET /api/residents?propertyId=&status= — used by pickers and forms. */
const querySchema = z.object({
  propertyId: z.string().optional(),
  status: z.string().optional(),
  q: z.string().optional(),
})

export const GET = route(async ({ user, request }) => {
  const url = new URL(request.url)
  const query = querySchema.parse(Object.fromEntries(url.searchParams))
  if (!user.organizationId) throw new ValidationError('No organization')

  const residents = await prisma.resident.findMany({
    where: {
      organizationId: user.organizationId,
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...(user.propertyIds.length ? { propertyId: { in: user.propertyIds } } : {}),
      ...(query.status ? { status: query.status as never } : { status: { in: ['ACTIVE', 'NOTICE'] } }),
      ...(query.q ? { fullName: { contains: query.q, mode: 'insensitive' } } : {}),
    },
    select: {
      id: true,
      code: true,
      fullName: true,
      phone: true,
      rentAmount: true,
      room: { select: { number: true } },
      bed: { select: { label: true } },
      property: { select: { id: true, name: true, type: true } },
      invoices: {
        where: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
        select: { id: true, number: true, balance: true, dueDate: true, status: true },
        orderBy: { dueDate: 'asc' },
      },
    },
    orderBy: { fullName: 'asc' },
    take: 300,
  })

  return {
    residents: residents.map((r) => ({
      ...r,
      outstanding: r.invoices.reduce((s, i) => s + i.balance, 0),
    })),
  }
})
