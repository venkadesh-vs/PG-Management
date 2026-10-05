import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fail, route } from '@/lib/api-helpers'
import { formatDate } from '@/lib/utils'
import { GST_STATE_CODES, SAAS_SAC, stateCodeFor } from '@/lib/gst'
import { platformEnv } from '@/lib/platform-env'
import { renderDocument, rs } from '@/server/documents/pdf'

/**
 * GET /api/documents/subscription-invoice/<id>.pdf
 *
 * StayFlow's tax invoice for a PG's SaaS subscription. The OWNER of that
 * organization or a SUPER_ADMIN only. The GST split is re-derived from the
 * stored amount/tax with the same rule used when the invoice was raised
 * (CGST+SGST intra-state, IGST inter-state).
 */
export const GET = route(
  async ({ user, request }) => {
    const parts = new URL(request.url).pathname.split('/')
    const id = decodeURIComponent(parts[parts.length - 1]).replace(/\.pdf$/, '')

    const invoice = await prisma.subscriptionInvoice.findUnique({
      where: { id },
      include: {
        subscription: {
          include: {
            property: { select: { name: true, addressLine: true, city: true } },
            organization: {
              select: {
                id: true,
                name: true,
                legalName: true,
                gstin: true,
                addressLine: true,
                city: true,
                state: true,
                contactEmail: true,
              },
            },
          },
        },
        payments: { where: { status: 'SUCCESS' }, select: { isDemo: true } },
      },
    })
    if (!invoice) return fail('Invoice not found', 404)
    const org = invoice.subscription.organization
    const allowed =
      user.role === 'SUPER_ADMIN' || (user.role === 'OWNER' && user.organizationId === org.id)
    if (!allowed) return fail('Invoice not found', 404)

    // Re-derive the split from what was actually charged.
    const recipientState = stateCodeFor({ gstin: org.gstin, state: org.state })
    const placeOfSupply = recipientState ?? (platformEnv.stateCode || null)
    const intraState = !recipientState || recipientState === platformEnv.stateCode
    const cgst = intraState ? Math.round(invoice.tax / 2) : 0
    const sgst = intraState ? invoice.tax - cgst : 0
    const igst = intraState ? 0 : invoice.tax
    const registered = Boolean(platformEnv.gstin)
    const isDemo = invoice.payments.some((p) => p.isDemo)

    const totals: [string, string, boolean?][] = [['Taxable value', rs(invoice.amount)]]
    if (invoice.tax > 0) {
      if (intraState) {
        totals.push(['CGST @ 9%', rs(cgst)], ['SGST @ 9%', rs(sgst)])
      } else {
        totals.push(['IGST @ 18%', rs(igst)])
      }
    }
    totals.push(['Total', rs(invoice.total), true])
    if (invoice.amountPaid > 0 && invoice.amountPaid < invoice.total) {
      totals.push(['Paid', rs(invoice.amountPaid)], ['Balance due', rs(invoice.total - invoice.amountPaid), true])
    }

    const pdf = await renderDocument({
      title: registered && invoice.tax > 0 ? 'Tax Invoice' : 'Invoice',
      reference: invoice.number,
      issuer: {
        name: platformEnv.legalName,
        lines: [
          ...(platformEnv.address ? platformEnv.address.split('|').map((l) => l.trim()) : []),
          ...(registered ? [`GSTIN ${platformEnv.gstin}`] : ['Not registered under GST']),
        ],
      },
      billTo: {
        label: 'Billed to',
        name: org.legalName || org.name,
        lines: [
          ...(org.gstin ? [`GSTIN ${org.gstin}`] : ['Unregistered (B2C)']),
          [org.addressLine, org.city, org.state].filter(Boolean).join(', '),
          org.contactEmail,
        ].filter(Boolean),
      },
      meta: [
        ['Invoice date', formatDate(invoice.issueDate)],
        ['Due', formatDate(invoice.dueDate)],
        [
          'Place of supply',
          placeOfSupply ? `${GST_STATE_CODES[placeOfSupply] ?? ''} (${placeOfSupply})` : '-',
        ],
        ['SAC', SAAS_SAC],
        ['Status', invoice.status.replace('_', ' ')],
      ],
      items: [
        {
          label: `StayFlow subscription - ${invoice.subscription.property.name} (${formatDate(invoice.periodStart)} to ${formatDate(invoice.periodEnd)}) - SAC ${SAAS_SAC}`,
          qty: 1,
          amount: invoice.amount,
        },
      ],
      totals,
      stamp: isDemo
        ? { text: 'DEMO', tone: 'demo' }
        : invoice.status === 'PAID'
          ? { text: 'PAID', tone: 'paid' }
          : invoice.status === 'OVERDUE'
            ? { text: 'OVERDUE', tone: 'due' }
            : undefined,
      notes: [
        ...(invoice.tax > 0 ? ['Tax is not payable on reverse charge basis.'] : []),
        ...(isDemo ? ['Demo record - no money was charged.'] : []),
      ],
      footer: `Computer-generated invoice from StayFlow on ${formatDate(new Date())}. No signature required.`,
    })

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${invoice.number.replace(/\//g, '-')}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  },
  { roles: ['OWNER', 'SUPER_ADMIN'], allowRestricted: true },
)
