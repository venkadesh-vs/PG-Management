import { z } from 'zod'

/**
 * Checkout room inspection and clearance checklists (stored as JSON on
 * Checkout.inspection / Checkout.clearance). Pure, shared by the checkout
 * dialog, the API and the settlement PDF.
 */

export const INSPECTION_ITEMS = [
  { key: 'room_clean', label: 'Room left clean' },
  { key: 'walls', label: 'Walls and paint — no marks or damage' },
  { key: 'furniture', label: 'Cot, mattress, table and cupboard intact' },
  { key: 'electricals', label: 'Fan, lights and switches working' },
  { key: 'bathroom', label: 'Bathroom fittings intact' },
  { key: 'windows_doors', label: 'Windows, doors and locks intact' },
] as const

export const CLEARANCE_ITEMS = [
  { key: 'keys', label: 'Room and cupboard keys returned' },
  { key: 'access_card', label: 'ID / access card returned' },
  { key: 'belongings', label: 'Personal belongings removed' },
  { key: 'dues', label: 'Dues settled or agreed' },
  { key: 'forwarding', label: 'Forwarding address / bank details noted' },
] as const

export type ChecklistItem = { key: string; label: string; ok: boolean; note?: string }
export type Checklist = { items: ChecklistItem[]; notes?: string; photoUrls?: string[] }

const itemSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(120),
  ok: z.boolean(),
  note: z.string().trim().max(200).optional(),
})

const uploadUrl = z
  .string()
  .trim()
  .regex(/^\/api\/uploads\/[A-Za-z0-9_-]+$/, 'Attach photos with the upload button')

export const checklistSchema = z.object({
  items: z.array(itemSchema).max(30),
  notes: z.string().trim().max(1000).optional(),
  photoUrls: z.array(uploadUrl).max(10).optional(),
})

/** A blank checklist for the dialog: every standard item, not yet ticked. */
export function blankChecklist(kind: 'inspection' | 'clearance'): Checklist {
  const items = kind === 'inspection' ? INSPECTION_ITEMS : CLEARANCE_ITEMS
  return { items: items.map((i) => ({ key: i.key, label: i.label, ok: false })) }
}

/** Reads whatever is stored (or nothing) into a well-formed checklist. */
export function readChecklist(value: unknown): Checklist | null {
  const parsed = checklistSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function checklistProgress(list: Checklist | null) {
  const total = list?.items.length ?? 0
  const done = list?.items.filter((i) => i.ok).length ?? 0
  return { done, total, complete: total > 0 && done === total }
}

/** Items not ticked, for the lock warning and the PDF. */
export function openItems(list: Checklist | null) {
  return (list?.items ?? []).filter((i) => !i.ok)
}

// --------------------------------------------------------------------------
// Asset damage at checkout
// --------------------------------------------------------------------------

export const ASSET_STATUSES = ['IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED', 'MISSING'] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  IN_USE: 'In use',
  IN_STORE: 'In store',
  UNDER_REPAIR: 'Under repair',
  DISPOSED: 'Disposed',
  MISSING: 'Missing',
}

export const assetDamageSchema = z.object({
  assetId: z.string().min(1),
  outcome: z.enum(['DAMAGED', 'MISSING']),
  amount: z.coerce.number().int('Enter a whole rupee amount').min(0, 'Amounts cannot be negative').max(10_00_000),
  note: z.string().trim().max(200).optional(),
})
export type AssetDamage = z.infer<typeof assetDamageSchema>

/** The settlement deduction for a damaged or missing asset. */
export function assetDeductionLabel(name: string, outcome: 'DAMAGED' | 'MISSING', note?: string) {
  return `${outcome === 'MISSING' ? 'Missing' : 'Damaged'} — ${name}${note ? ` (${note})` : ''}`.slice(0, 80)
}
