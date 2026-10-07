import { z } from 'zod'

/**
 * Shared Zod schemas. The same object validates the React Hook Form on the
 * client and the request body on the server, so the two can never drift.
 */

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number')

export const optionalPhone = z
  .string()
  .trim()
  .regex(/^(\+?91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
  .optional()
  .or(z.literal(''))

const optionalString = z.string().trim().optional().or(z.literal(''))
const rupees = z.coerce.number().int('Enter a whole rupee amount').min(0, 'Cannot be negative')

// ------------------------------------------------------------- resident ----

export const checkInSchema = z.object({
  // Step 1 — personal
  fullName: z.string().trim().min(2, 'Enter the resident’s full name').max(120),
  phone: phoneSchema,
  whatsappPhone: optionalPhone,
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  dateOfBirth: optionalString,
  gender: optionalString,
  bloodGroup: optionalString,
  qualification: optionalString,
  photoUrl: optionalString,

  // Step 2 — guardian & address
  guardianName: optionalString,
  guardianRelation: optionalString,
  guardianPhone: optionalPhone,
  guardianAddress: optionalString,
  permanentAddress: optionalString,
  city: optionalString,
  state: optionalString,
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'PIN code must be 6 digits')
    .optional()
    .or(z.literal('')),

  // Step 3 — KYC & occupation
  idType: optionalString,
  idNumber: optionalString,
  occupationType: z.enum(['STUDENT', 'WORKING', 'OTHER']).optional(),
  companyName: optionalString,
  companyAddress: optionalString,
  designation: optionalString,
  documents: z
    .array(z.object({ kind: z.string(), label: z.string(), fileUrl: z.string() }))
    .optional(),

  // Step 4 — placement
  propertyId: z.string().min(1, 'Choose a PG'),
  bedId: z.string().min(1, 'Choose an available bed'),
  joiningDate: z.string().min(1, 'Choose the joining date'),

  // Step 5 — money
  rentAmount: rupees.refine((v) => v > 0, 'Rent must be greater than zero'),
  depositAmount: rupees,
  maintenanceFee: rupees.optional(),
  foodOptIn: z.boolean().default(true),
  foodCharge: rupees.optional(),
  foodPlanId: optionalString,
  rentDueDay: z.coerce.number().int().min(1).max(28).default(5),
  discountAmount: rupees.optional(),
  discountNote: optionalString,
  depositCollected: z.boolean().default(false),

  // Step 6 — finish
  createTenantAccount: z.boolean().default(true),
  /** WhatsApp Business policy: rent reminders need recorded consent. */
  whatsappConsent: z.boolean().default(true),
  notes: optionalString,
  signatureUrl: optionalString,
  /** Set when checking in from a booking (/app/residents/new?booking=…). */
  bookingId: optionalString,
})

export type CheckInValues = z.infer<typeof checkInSchema>

export const residentUpdateSchema = checkInSchema
  .partial()
  .omit({ bedId: true, propertyId: true, joiningDate: true, whatsappConsent: true, bookingId: true })
  .extend({ kycStatus: z.enum(['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED']).optional() })

export const transferSchema = z.object({
  residentId: z.string().min(1),
  toBedId: z.string().min(1, 'Choose the new bed'),
  effectiveDate: z.string().optional(),
})

export const noticeSchema = z.object({
  residentId: z.string().min(1),
  noticeDate: z.string().min(1),
  exitDate: z.string().min(1),
})

export const checkoutSchema = z.object({
  residentId: z.string().min(1),
  exitDate: z.string().min(1, 'Choose the exit date'),
  reason: optionalString,
  damageDeduction: rupees.optional(),
  otherCharges: rupees.optional(),
  settlementNote: optionalString,
  refundPaid: z.boolean().default(false),
})

// -------------------------------------------------------------- billing ----

export const paymentSchema = z.object({
  residentId: z.string().min(1, 'Choose a resident'),
  amount: rupees.refine((v) => v > 0, 'Enter an amount greater than zero'),
  method: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'GATEWAY', 'ADJUSTMENT']),
  paidAt: optionalString,
  reference: optionalString,
  notes: optionalString,
  invoiceIds: z.array(z.string()).optional(),
})

export const generateInvoiceSchema = z.object({
  residentId: z.string().optional(),
  month: z.string().optional(),
  allResidents: z.boolean().optional(),
})

export const utilitySplitSchema = z.object({
  propertyId: z.string().min(1),
  month: z.string().min(1),
  kind: z.enum(['ELECTRICITY', 'WATER', 'GAS']),
  totalAmount: rupees.refine((v) => v > 0, 'Enter the bill amount'),
})

// ------------------------------------------------------------- property ----

export const propertySchema = z.object({
  name: z.string().trim().min(3, 'Give the PG a name').max(120),
  code: z
    .string()
    .trim()
    .min(2, 'Short code is required')
    .max(8)
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only'),
  type: z.enum(['MENS', 'WOMENS', 'COLIVE']),
  addressLine: z.string().trim().min(5, 'Enter the address'),
  city: z.string().trim().min(2, 'Enter the city'),
  state: z.string().trim().min(2, 'Enter the state'),
  pincode: z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits'),
  contactName: optionalString,
  contactPhone: optionalPhone,
  description: optionalString,
  standardRent: rupees.refine((v) => v > 0, 'Standard rent is required'),
  standardDeposit: rupees,
  maintenanceFee: rupees.optional(),
  foodCharge: rupees.optional(),
  foodIncluded: z.boolean().default(true),
  electricityMode: z.enum(['INCLUDED', 'SHARED', 'METERED']).default('INCLUDED'),
  electricityRate: rupees.optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(120).default(30),
  amenities: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
})

export const floorSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().trim().min(1, 'Name the floor'),
  level: z.coerce.number().int().min(0).max(50),
})

export const roomSchema = z.object({
  propertyId: z.string().min(1),
  floorId: z.string().min(1, 'Choose a floor'),
  number: z.string().trim().min(1, 'Room number is required').max(12),
  type: z.enum(['SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD', 'DORM']),
  capacity: z.coerce.number().int().min(1, 'At least one bed').max(12),
  baseRent: rupees.optional(),
  hasAC: z.boolean().default(false),
  hasBalcony: z.boolean().default(false),
  hasAttachedBath: z.boolean().default(true),
  notes: optionalString,
})

export const bedUpdateSchema = z.object({
  bedId: z.string().min(1),
  status: z.enum(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE', 'BLOCKED']).optional(),
  rent: rupees.optional(),
  notes: optionalString,
  blockedReason: optionalString,
})

// ----------------------------------------------------------- operations ----

export const complaintSchema = z.object({
  propertyId: z.string().min(1, 'Choose a PG'),
  residentId: optionalString,
  roomId: optionalString,
  /** A COMPLAINT_CATEGORY lookup value; the server checks it is one of the org's. */
  category: z.string().trim().min(1, 'Choose a category').max(60),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  title: z.string().trim().min(4, 'Describe the issue in a few words').max(140),
  description: z.string().trim().min(10, 'Add a little more detail').max(2000),
  photoUrls: z.array(z.string()).default([]),
})

export const complaintActionSchema = z.object({
  complaintId: z.string().min(1),
  action: z.enum(['ASSIGN', 'STATUS', 'COMMENT']),
  staffId: optionalString,
  status: z
    .enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'REJECTED'])
    .optional(),
  message: optionalString,
  photoUrl: optionalString,
  rating: z.coerce.number().int().min(1).max(5).optional(),
  dueDate: optionalString,
})

export const taskSchema = z.object({
  propertyId: z.string().min(1, 'Choose a PG'),
  title: z.string().trim().min(3, 'Give the task a title').max(140),
  description: optionalString,
  kind: z.enum(['MAINTENANCE', 'CLEANING', 'FOOD', 'GROCERY', 'OTHER']).default('MAINTENANCE'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  dueDate: optionalString,
  assignedStaffId: optionalString,
  roomId: optionalString,
})

export const taskActionSchema = z.object({
  taskId: z.string().min(1),
  action: z.enum(['ACCEPT', 'START', 'COMPLETE', 'CANCEL']),
  note: optionalString,
  photoUrl: optionalString,
})

export const expenseSchema = z.object({
  propertyId: z.string().min(1, 'Choose a PG'),
  categoryId: z.string().min(1, 'Choose a category'),
  title: z.string().trim().min(3, 'Describe the expense').max(140),
  amount: rupees.refine((v) => v > 0, 'Enter an amount'),
  spentOn: z.string().min(1, 'Choose the date'),
  paidTo: optionalString,
  paymentMode: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE']).default('CASH'),
  reference: optionalString,
  notes: optionalString,
})

export const staffSchema = z.object({
  name: z.string().trim().min(2, 'Enter the name'),
  /** A STAFF_ROLE lookup value (job title); the server checks it is one of the org's. */
  role: z.string().trim().min(1, 'Choose a job title').max(60),
  phone: phoneSchema,
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  propertyId: optionalString,
  joiningDate: z.string().min(1, 'Choose the joining date'),
  salary: rupees.optional(),
  address: optionalString,
  idNumber: optionalString,
  createLogin: z.boolean().default(false),
  /** Staff-app role for the login (OrgRole with app STAFF_APP). */
  orgRoleId: optionalString,
})

export const attendanceSchema = z.object({
  staffId: z.string().min(1),
  date: z.string().min(1),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'WEEKLY_OFF']),
  notes: optionalString,
})

export const visitorSchema = z.object({
  propertyId: z.string().min(1, 'Choose a PG'),
  residentId: optionalString,
  name: z.string().trim().min(2, 'Enter the visitor’s name'),
  phone: optionalPhone,
  /** A VISITOR_PURPOSE lookup value (free text accepted for older records). */
  purpose: z.string().trim().min(1, 'What is the visit for?').max(80),
  relation: optionalString,
  idProof: optionalString,
  notes: optionalString,
})

export const assetSchema = z.object({
  propertyId: z.string().min(1, 'Choose a PG'),
  roomId: optionalString,
  name: z.string().trim().min(2, 'Enter the item name'),
  category: z.string().trim().min(2, 'Enter a category'),
  quantity: z.coerce.number().int().min(1).default(1),
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'NEEDS_REPAIR', 'DAMAGED', 'DISPOSED']).default('GOOD'),
  location: optionalString,
  purchaseDate: optionalString,
  purchaseCost: rupees.optional(),
  serialNumber: optionalString,
  notes: optionalString,
  /** Where it sits: '' (the PG), 'floor:<id>', 'room:<id>' or 'bed:<id>'. Overrides roomId. */
  placement: z
    .string()
    .trim()
    .regex(/^((floor|room|bed):[A-Za-z0-9_-]+)?$/, 'Choose where the item is')
    .optional(),
  status: z.enum(['IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED', 'MISSING']).optional(),
  currentValue: z.union([z.literal(''), rupees]).optional(),
})

export const announcementSchema = z.object({
  title: z.string().trim().min(3, 'Give the announcement a title').max(140),
  body: z.string().trim().min(10, 'Write the message').max(4000),
  audience: z.enum(['ALL_PROPERTIES', 'PROPERTY', 'FLOOR', 'SELECTED_RESIDENTS', 'STAFF']),
  propertyId: optionalString,
  floorId: optionalString,
  residentIds: z.array(z.string()).optional(),
  pinned: z.boolean().default(false),
  sendWhatsapp: z.boolean().default(false),
})

// ------------------------------------------------------------- kitchen ----

export const mealSchema = z.object({
  propertyId: z.string().min(1),
  date: z.string().min(1),
  type: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']),
  menu: z.string().trim().min(3, 'Enter the menu'),
  notes: optionalString,
})

export const mealServedSchema = z.object({
  mealId: z.string().min(1),
  actualCount: z.coerce.number().int().min(0),
})

export const mealOptSchema = z.object({
  mealId: z.string().min(1),
  status: z.enum(['EXPECTED', 'SKIPPED', 'ON_LEAVE', 'ATTENDED']),
})

export const groceryItemSchema = z.object({
  propertyId: z.string().min(1, 'Choose a PG'),
  name: z.string().trim().min(2, 'Enter the item name'),
  category: z.string().trim().min(2, 'Enter a category'),
  unit: z.enum(['KG', 'GRAM', 'LITRE', 'ML', 'PIECE', 'PACKET', 'DOZEN', 'CYLINDER']),
  currentStock: z.coerce.number().int().min(0).default(0),
  minimumStock: z.coerce.number().int().min(0).default(0),
  perResidentPerMeal: z.coerce.number().int().min(0).default(0),
  vendor: optionalString,
})

export const purchaseSchema = z.object({
  propertyId: z.string().min(1),
  groceryItemId: z.string().min(1, 'Choose an item'),
  quantity: z.coerce.number().int().min(1, 'Enter the quantity'),
  unitPrice: rupees.refine((v) => v > 0, 'Enter the unit price'),
  vendor: optionalString,
  purchaseDate: z.string().min(1),
  invoiceRef: optionalString,
  createExpense: z.boolean().default(true),
})

// ------------------------------------------------------------- account ----

export const settingsSchema = z.object({
  rentDueDay: z.coerce.number().int().min(1).max(28),
  rentGenerateDay: z.coerce.number().int().min(1).max(28),
  lateFeeEnabled: z.boolean(),
  lateFeeGraceDays: z.coerce.number().int().min(0).max(30),
  lateFeeAmount: rupees,
  lateFeePerDay: rupees,
  reminderDaysBefore: z.coerce.number().int().min(0).max(15),
  reminderOnDueDate: z.boolean(),
  reminderAfterDays: z.coerce.number().int().min(1).max(15),
  whatsappEnabled: z.boolean(),
  upiId: optionalString,
  upiPayeeName: optionalString,
  invoicePrefix: z.string().trim().min(1).max(6),
  receiptPrefix: z.string().trim().min(1).max(6),
})

export const planSchema = z.object({
  name: z.string().trim().min(2),
  slug: z.string().trim().min(2).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and dashes'),
  description: optionalString,
  pricingBasis: z.enum(['STANDARD_RENT', 'PER_BED', 'FLAT']),
  multiplier: z.coerce.number().int().min(1).max(500),
  perBedPrice: rupees,
  flatPrice: rupees,
  minAmount: rupees,
  maxAmount: rupees,
  trialDays: z.coerce.number().int().min(0).max(90),
  graceDays: z.coerce.number().int().min(0).max(60),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
})

// ---------------------------------------------------------------- leads ----

export const leadSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(120),
  phone: phoneSchema,
  whatsapp: optionalPhone,
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  pgName: optionalString,
  pgCount: z.coerce.number().int().min(1).max(100).default(1),
  pgTypes: z.enum(['MENS', 'WOMENS', 'BOTH']).optional(),
  bedCount: z.coerce.number().int().min(1).max(10000).optional(),
  rentRange: optionalString,
  currentMethod: optionalString,
  city: optionalString,
  preferredDemoAt: optionalString,
  message: optionalString,
  source: z.string().default('website'),
})

export const leadUpdateSchema = z.object({
  leadId: z.string().min(1),
  status: z
    .enum(['NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED', 'TRIAL', 'CONVERTED', 'LOST'])
    .optional(),
  note: optionalString,
  demoAt: optionalString,
})

// ------------------------------------------------------------- accounts ----

/** Platform admin creating a client account (also used to convert a lead). */
export const createClientSchema = z.object({
  orgName: z.string().trim().min(2, 'Enter the business / PG name').max(120),
  ownerName: z.string().trim().min(2, 'Enter the owner name').max(120),
  email: z.string().trim().email('Enter a valid email'),
  phone: phoneSchema,
  city: z.string().trim().max(80).optional().or(z.literal('')),
})
