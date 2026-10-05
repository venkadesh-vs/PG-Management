/**
 * StayFlow demo seed.
 *
 * Builds a complete, realistic organisation: two PGs (one men's, one
 * women's), floors/rooms/beds, ~65 residents in mixed states, ten months of
 * invoices and payments, complaints at every stage, food plans and meals,
 * grocery stock and purchases, expenses, staff, visitors, assets,
 * announcements, notifications, activity logs, subscriptions and website
 * leads.
 *
 * Deterministic: a fixed PRNG seed means every run produces the same demo.
 * Idempotent: it truncates the tenant tables first, so `npm run db:seed` can
 * be re-run at any time.
 */

import { PrismaClient, type Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import {
  ANNOUNCEMENTS,
  ASSET_TEMPLATES,
  BLOOD_GROUPS,
  BREAKFAST_MENUS,
  CITIES,
  COLLEGES,
  COMPANIES,
  COMPLAINT_TEMPLATES,
  DINNER_MENUS,
  EXPENSE_TEMPLATES,
  FEMALE_NAMES,
  GROCERY_BASKET,
  GUARDIAN_RELATIONS,
  LEADS,
  LUNCH_MENUS,
  MALE_NAMES,
  QUALIFICATIONS,
  VENDORS,
  VISITOR_PURPOSES,
} from './seed-data'

const prisma = new PrismaClient()

// ---------------------------------------------------------------- utils ----

/** Mulberry32 — small deterministic PRNG so the demo never shuffles. */
function makeRandom(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = makeRandom(20260915)

const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]
const chance = (p: number) => rnd() < p
const round = (n: number, to = 100) => Math.round(n / to) * to

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate())
const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
const dayOfMonth = (y: number, m: number, day: number) =>
  new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()))
const monthLabel = (d: Date) =>
  d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
const money = (n: number) => `₹${new Intl.NumberFormat('en-IN').format(n)}`

const TODAY = startOfDay(new Date())
const PASSWORD = process.env.SEED_PASSWORD ?? 'StayFlow@2026'

// ------------------------------------------------------------- cleanup ----

async function reset() {
  console.log('  clearing existing data…')
  // Order matters only where there is no cascade; most FKs cascade from
  // Organization, so the two root deletes do the bulk of the work.
  await prisma.analyticsEvent.deleteMany()
  await prisma.leadNote.deleteMany()
  await prisma.lead.deleteMany()
  await prisma.session.deleteMany()
  await prisma.subscriptionPayment.deleteMany()
  await prisma.subscriptionInvoice.deleteMany()
  await prisma.paymentMethod.deleteMany()
  await prisma.subscription.deleteMany()
  await prisma.organization.deleteMany()
  await prisma.user.deleteMany()
  await prisma.plan.deleteMany()
  await prisma.featureFlag.deleteMany()
  await prisma.systemSetting.deleteMany()
}

// --------------------------------------------------------------- plans ----

async function seedPlatform(passwordHash: string) {
  console.log('  plans, features and the platform owner…')

  const [starter, growth, scale] = await Promise.all([
    prisma.plan.create({
      data: {
        name: 'Starter',
        slug: 'starter',
        description: 'For a single PG getting off notebooks.',
        pricingBasis: 'STANDARD_RENT',
        multiplier: 100,
        minAmount: 2000,
        maxAmount: 12000,
        trialDays: 14,
        graceDays: 7,
        maxProperties: 1,
        features: ['residents', 'rooms', 'rent', 'complaints', 'whatsapp'],
        isDefault: false,
      },
    }),
    prisma.plan.create({
      data: {
        name: 'Growth',
        slug: 'growth',
        description:
          'One PG subscription equals roughly one standard resident rent. Everything included.',
        pricingBasis: 'STANDARD_RENT',
        multiplier: 100,
        minAmount: 3000,
        maxAmount: 25000,
        trialDays: 14,
        graceDays: 7,
        features: [
          'residents', 'rooms', 'rent', 'complaints', 'whatsapp',
          'food', 'grocery', 'staff', 'reports', 'tenant_app', 'worker_app',
        ],
        isDefault: true,
      },
    }),
    prisma.plan.create({
      data: {
        name: 'Scale',
        slug: 'scale',
        description: 'Per-bed pricing for operators running many properties.',
        pricingBasis: 'PER_BED',
        perBedPrice: 90,
        minAmount: 8000,
        maxAmount: 60000,
        trialDays: 7,
        graceDays: 10,
        features: [
          'residents', 'rooms', 'rent', 'complaints', 'whatsapp', 'food',
          'grocery', 'staff', 'reports', 'tenant_app', 'worker_app', 'api', 'priority_support',
        ],
      },
    }),
  ])

  await prisma.featureFlag.createMany({
    data: [
      { key: 'whatsapp_reminders', name: 'WhatsApp rent reminders', description: 'Automatic reminders before, on and after the due date.', plans: ['starter', 'growth', 'scale'] },
      { key: 'tenant_app', name: 'Resident app', description: 'Residents pay rent, raise complaints and see the menu.', plans: ['growth', 'scale'] },
      { key: 'worker_app', name: 'Worker app', description: 'Task list for maintenance, kitchen and cleaning staff.', plans: ['growth', 'scale'] },
      { key: 'food_module', name: 'Food & meal planning', description: 'Meal counts derived from live food subscriptions.', plans: ['growth', 'scale'] },
      { key: 'grocery_module', name: 'Grocery & inventory', description: 'Stock, low-stock alerts and purchase lists.', plans: ['growth', 'scale'] },
      { key: 'online_payments', name: 'Online rent collection', description: 'Payment links, UPI and gateway reconciliation.', plans: ['growth', 'scale'] },
      { key: 'multi_property', name: 'Multiple PGs', description: 'Manage more than one property from one login.', plans: ['growth', 'scale'] },
      { key: 'advanced_reports', name: 'Advanced reports', description: 'Profit estimates and PG-versus-PG comparison.', plans: ['scale'] },
      { key: 'api_access', name: 'API access', description: 'Programmatic access for custom integrations.', enabled: false, plans: ['scale'] },
    ],
  })

  await prisma.systemSetting.createMany({
    data: [
      { key: 'platform:name', value: 'StayFlow' as Prisma.InputJsonValue },
      { key: 'platform:support_email', value: 'support@stayflow.app' as Prisma.InputJsonValue },
      {
        key: 'pricing:defaults',
        value: {
          basis: 'STANDARD_RENT',
          multiplier: 100,
          minAmount: 3000,
          maxAmount: 25000,
          trialDays: 14,
          graceDays: 7,
        } as Prisma.InputJsonValue,
      },
    ],
  })

  const superAdmin = await prisma.user.create({
    data: {
      email: 'admin@stayflow.app',
      name: 'Priya Raghavan',
      phone: '9840100001',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  })

  return { plans: { starter, growth, scale }, superAdmin }
}

// -------------------------------------------------------- organisations ----

const EXPENSE_CATEGORIES = [
  { name: 'Groceries', slug: 'groceries', icon: 'ShoppingCart', color: '#f59e0b' },
  { name: 'Food & Kitchen', slug: 'food', icon: 'Utensils', color: '#ef4444' },
  { name: 'Electricity', slug: 'electricity', icon: 'Zap', color: '#eab308' },
  { name: 'Water', slug: 'water', icon: 'Droplets', color: '#0ea5e9' },
  { name: 'Gas', slug: 'gas', icon: 'Flame', color: '#f97316' },
  { name: 'Maintenance', slug: 'maintenance', icon: 'Wrench', color: '#8b5cf6' },
  { name: 'Cleaning', slug: 'cleaning', icon: 'Sparkles', color: '#14b8a6' },
  { name: 'Staff Salary', slug: 'salary', icon: 'Users', color: '#3b82f6' },
  { name: 'Internet', slug: 'internet', icon: 'Wifi', color: '#6366f1' },
  { name: 'Repairs', slug: 'repairs', icon: 'Hammer', color: '#a855f7' },
  { name: 'Other', slug: 'other', icon: 'Receipt', color: '#64748b' },
]

async function main() {
  console.log('\nStayFlow seed\n' + '─'.repeat(40))
  const passwordHash = await bcrypt.hash(PASSWORD, 10)

  await reset()
  const { plans, superAdmin } = await seedPlatform(passwordHash)

  // ------------------------------------------------------ organisation ----
  console.log('  organisation and team…')
  const org = await prisma.organization.create({
    data: {
      name: 'StayFlow Demo Residences',
      slug: 'stayflow-demo',
      ownerName: 'Murugan Selvaraj',
      contactEmail: 'owner@stayflow.app',
      contactPhone: '9840200002',
      whatsappPhone: '9840200002',
      city: 'Chennai',
      state: 'Tamil Nadu',
      addressLine: 'No. 42, 2nd Main Road, Thoraipakkam',
      status: 'ACTIVE',
      settings: {
        create: {
          rentDueDay: 5,
          rentGenerateDay: 1,
          lateFeeEnabled: true,
          lateFeeGraceDays: 5,
          lateFeeAmount: 250,
          lateFeePerDay: 0,
          reminderDaysBefore: 3,
          reminderOnDueDate: true,
          reminderAfterDays: 3,
          whatsappEnabled: true,
          upiId: 'stayflowdemo@okicici',
          upiPayeeName: 'StayFlow Demo Residences',
        },
      },
    },
  })

  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: 'owner@stayflow.app',
      name: 'Murugan Selvaraj',
      phone: '9840200002',
      passwordHash,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  })

  const manager = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: 'manager@stayflow.app',
      name: 'Kalaiselvi Murugan',
      phone: '9840200003',
      passwordHash,
      role: 'MANAGER',
      status: 'ACTIVE',
    },
  })

  const categories = await Promise.all(
    EXPENSE_CATEGORIES.map((c) =>
      prisma.expenseCategory.create({ data: { ...c, organizationId: org.id } }),
    ),
  )
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]))

  // ---------------------------------------------------------- properties ----
  console.log('  properties, floors, rooms and beds…')

  const mensPg = await prisma.property.create({
    data: {
      organizationId: org.id,
      name: "StayFlow Men's Residence",
      code: 'SFM',
      type: 'MENS',
      addressLine: 'No. 42, 2nd Main Road, Thoraipakkam',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600097',
      contactName: 'Murugan Selvaraj',
      contactPhone: '9840200002',
      description:
        'Walking distance from the OMR IT corridor. Three floors, AC and non-AC rooms, three meals a day.',
      standardRent: 8000,
      standardDeposit: 10000,
      maintenanceFee: 300,
      foodCharge: 2500,
      foodIncluded: true,
      electricityMode: 'SHARED',
      electricityRate: 9,
      noticePeriodDays: 30,
      amenities: ['WiFi', 'Three meals', 'Power backup', 'Washing machine', 'CCTV', 'Hot water', 'Housekeeping', 'Parking'],
      rules: [
        'Entry closes at 11:00 PM',
        'Visitors allowed between 9 AM and 8 PM',
        'No smoking or alcohol inside the premises',
        'One month notice before vacating',
        'Keep the common areas clean',
      ],
    },
  })

  const womensPg = await prisma.property.create({
    data: {
      organizationId: org.id,
      name: "StayFlow Women's Residence",
      code: 'SFW',
      type: 'WOMENS',
      addressLine: 'No. 18, Lake View Street, Perungudi',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600096',
      contactName: 'Kalaiselvi Murugan',
      contactPhone: '9840200003',
      description:
        'Secure women-only accommodation near Perungudi with 24×7 security, warden on site and home-style food.',
      standardRent: 9000,
      standardDeposit: 12000,
      maintenanceFee: 300,
      foodCharge: 2800,
      foodIncluded: true,
      electricityMode: 'SHARED',
      electricityRate: 9,
      noticePeriodDays: 30,
      amenities: ['WiFi', 'Three meals', '24×7 security', 'Warden', 'Power backup', 'Washing machine', 'CCTV', 'Hot water', 'Housekeeping'],
      rules: [
        'Entry closes at 10:00 PM',
        'Visitors allowed in the reception area only',
        'Overnight leave requires a guardian intimation',
        'No smoking or alcohol inside the premises',
        'One month notice before vacating',
      ],
    },
  })

  type BedRow = { id: string; label: string; roomId: string; propertyId: string; rent: number; roomNumber: string }
  const allBeds: BedRow[] = []

  async function buildLayout(
    property: typeof mensPg,
    floors: { name: string; level: number; rooms: number }[],
    roomStart: number,
  ) {
    for (const floorSpec of floors) {
      const floor = await prisma.floor.create({
        data: { propertyId: property.id, name: floorSpec.name, level: floorSpec.level },
      })

      for (let r = 0; r < floorSpec.rooms; r++) {
        const number = `${floorSpec.level}${String(roomStart + r).padStart(2, '0')}`
        // A believable mix: mostly doubles and triples, a few singles/quads.
        const roll = rnd()
        const type = roll < 0.12 ? 'SINGLE' : roll < 0.55 ? 'DOUBLE' : roll < 0.9 ? 'TRIPLE' : 'QUAD'
        const capacity = type === 'SINGLE' ? 1 : type === 'DOUBLE' ? 2 : type === 'TRIPLE' ? 3 : 4
        const hasAC = chance(0.3)
        const baseRent =
          property.standardRent +
          (type === 'SINGLE' ? 3500 : type === 'DOUBLE' ? 800 : type === 'QUAD' ? -1200 : 0) +
          (hasAC ? 1500 : 0)

        const room = await prisma.room.create({
          data: {
            propertyId: property.id,
            floorId: floor.id,
            number,
            type,
            capacity,
            baseRent: round(baseRent, 100),
            hasAC,
            hasBalcony: chance(0.25),
            hasAttachedBath: chance(0.75),
          },
        })

        for (let b = 0; b < capacity; b++) {
          const label = String.fromCharCode(65 + b)
          const bed = await prisma.bed.create({
            data: {
              propertyId: property.id,
              floorId: floor.id,
              roomId: room.id,
              label,
              status: 'AVAILABLE',
              rent: room.baseRent,
            },
          })
          allBeds.push({
            id: bed.id,
            label,
            roomId: room.id,
            propertyId: property.id,
            rent: room.baseRent ?? property.standardRent,
            roomNumber: number,
          })
        }
      }
    }
  }

  await buildLayout(
    mensPg,
    [
      { name: 'Ground Floor', level: 1, rooms: 8 },
      { name: 'First Floor', level: 2, rooms: 9 },
      { name: 'Second Floor', level: 3, rooms: 9 },
    ],
    1,
  )
  await buildLayout(
    womensPg,
    [
      { name: 'Ground Floor', level: 1, rooms: 7 },
      { name: 'First Floor', level: 2, rooms: 8 },
      { name: 'Second Floor', level: 3, rooms: 7 },
    ],
    1,
  )

  const mensBeds = allBeds.filter((b) => b.propertyId === mensPg.id)
  const womensBeds = allBeds.filter((b) => b.propertyId === womensPg.id)
  console.log(`    ${allBeds.length} beds across ${mensBeds.length ? 2 : 1} properties`)

  // ---------------------------------------------------------- food plans ----
  console.log('  food plans, staff and grocery stock…')

  const foodPlans = new Map<string, string>()
  for (const property of [mensPg, womensPg]) {
    const full = await prisma.foodPlan.create({
      data: {
        organizationId: org.id,
        propertyId: property.id,
        name: 'Full board (3 meals)',
        description: 'Breakfast, lunch and dinner, seven days a week.',
        monthlyCharge: property.foodCharge,
        isDefault: true,
      },
    })
    await prisma.foodPlan.create({
      data: {
        organizationId: org.id,
        propertyId: property.id,
        name: 'Breakfast & dinner',
        description: 'For residents who eat lunch at office or college.',
        monthlyCharge: Math.round(property.foodCharge * 0.7),
        includesLunch: false,
      },
    })
    foodPlans.set(property.id, full.id)
  }

  // ------------------------------------------------------------- staff ----
  const STAFF_SPECS = [
    { name: 'Rajendran M', role: 'MANAGER', phone: '9840300001', salary: 32000, property: mensPg.id, worker: false },
    { name: 'Selvi Anandhi', role: 'COOK', phone: '9840300002', salary: 22000, property: mensPg.id, worker: true },
    { name: 'Murthy K', role: 'KITCHEN_HELPER', phone: '9840300003', salary: 15000, property: mensPg.id , worker: false },
    { name: 'Gopal Singh', role: 'SECURITY', phone: '9840300004', salary: 18000, property: mensPg.id , worker: false },
    { name: 'Suresh Plumber', role: 'PLUMBER', phone: '9840300005', salary: 20000, property: mensPg.id , worker: false },
    { name: 'Vasanthi R', role: 'CLEANER', phone: '9840300006', salary: 14000, property: mensPg.id , worker: false },
    { name: 'Kalaivani S', role: 'MANAGER', phone: '9840300007', salary: 30000, property: womensPg.id , worker: false },
    { name: 'Meena Kumari', role: 'COOK', phone: '9840300008', salary: 21000, property: womensPg.id , worker: false },
    { name: 'Pandi Raj', role: 'ELECTRICIAN', phone: '9840300009', salary: 19000, property: womensPg.id , worker: false },
    { name: 'Amudha Devi', role: 'CLEANER', phone: '9840300010', salary: 14000, property: womensPg.id , worker: false },
    { name: 'Chandran V', role: 'SECURITY', phone: '9840300011', salary: 18000, property: womensPg.id , worker: false },
    { name: 'Ravi Maintenance', role: 'MAINTENANCE', phone: '9840300012', salary: 20000, property: womensPg.id , worker: false },
  ] as const satisfies readonly {
    name: string
    role: Prisma.StaffCreateManyInput['role']
    phone: string
    salary: number
    property: string
    worker?: boolean
  }[]

  const staffRows: Awaited<ReturnType<typeof prisma.staff.create>>[] = []
  for (const [i, spec] of STAFF_SPECS.entries()) {
    let userId: string | undefined
    if (spec.worker) {
      const workerUser = await prisma.user.create({
        data: {
          organizationId: org.id,
          email: 'worker@stayflow.app',
          name: spec.name,
          phone: spec.phone,
          passwordHash,
          role: 'WORKER',
          status: 'ACTIVE',
        },
      })
      userId = workerUser.id
    } else if (i < 6) {
      // Give a few more staff a login so the worker app has real variety.
      const workerUser = await prisma.user.create({
        data: {
          organizationId: org.id,
          email: `${spec.name.split(' ')[0].toLowerCase()}.${i}@stayflow-demo.app`,
          name: spec.name,
          phone: spec.phone,
          passwordHash,
          role: 'WORKER',
          status: 'ACTIVE',
        },
      })
      userId = workerUser.id
    }

    const staff = await prisma.staff.create({
      data: {
        organizationId: org.id,
        propertyId: spec.property,
        userId,
        code: `STF-${String(i + 1).padStart(3, '0')}`,
        name: spec.name,
        role: spec.role,
        phone: spec.phone,
        salary: spec.salary,
        joiningDate: addMonths(TODAY, -int(4, 30)),
        active: true,
      },
    })
    staffRows.push(staff)
  }

  // Attendance for the last 30 days.
  const attendance: Prisma.StaffAttendanceCreateManyInput[] = []
  for (const staff of staffRows) {
    for (let d = 29; d >= 0; d--) {
      const date = addDays(TODAY, -d)
      if (date.getDay() === 0 && chance(0.7)) {
        attendance.push({ staffId: staff.id, date, status: 'WEEKLY_OFF' })
        continue
      }
      const roll = rnd()
      const status = roll < 0.87 ? 'PRESENT' : roll < 0.93 ? 'LATE' : roll < 0.97 ? 'LEAVE' : 'ABSENT'
      attendance.push({
        staffId: staff.id,
        date,
        status,
        checkIn: status === 'PRESENT' || status === 'LATE' ? new Date(date.getTime() + (status === 'LATE' ? 10 : 8) * 3600000) : null,
        checkOut: status === 'PRESENT' || status === 'LATE' ? new Date(date.getTime() + 19 * 3600000) : null,
      })
    }
  }
  await prisma.staffAttendance.createMany({ data: attendance })

  // ----------------------------------------------------------- grocery ----
  const groceryIds: { id: string; propertyId: string; price: number; name: string }[] = []
  for (const property of [mensPg, womensPg]) {
    for (const item of GROCERY_BASKET) {
      const scale = property.id === mensPg.id ? 1 : 0.8
      const created = await prisma.groceryItem.create({
        data: {
          organizationId: org.id,
          propertyId: property.id,
          name: item.name,
          category: item.category,
          unit: item.unit as never,
          currentStock: Math.round(item.stock * scale),
          minimumStock: Math.round(item.min * scale),
          perResidentPerMeal: item.perMeal,
          lastPurchasePrice: item.price,
          vendor: pick(VENDORS),
        },
      })
      groceryIds.push({ id: created.id, propertyId: property.id, price: item.price, name: item.name })
    }
  }

  // Purchases over the last 60 days, each with a matching expense.
  const groceryExpenseCategory = categoryBySlug.get('groceries')!
  for (let d = 60; d >= 0; d -= int(2, 4)) {
    const date = addDays(TODAY, -d)
    for (const property of [mensPg, womensPg]) {
      const basket = groceryIds.filter((g) => g.propertyId === property.id)
      const count = int(2, 5)
      for (let i = 0; i < count; i++) {
        const item = pick(basket)
        const quantity = int(5, 40)
        const unitPrice = Math.round(item.price * (0.92 + rnd() * 0.18))
        const total = quantity * unitPrice
        const expense = await prisma.expense.create({
          data: {
            organizationId: org.id,
            propertyId: property.id,
            categoryId: groceryExpenseCategory.id,
            title: `${item.name} — ${quantity} units`,
            amount: total,
            spentOn: date,
            paidTo: pick(VENDORS),
            paymentMode: chance(0.6) ? 'CASH' : 'UPI',
            recordedBy: 'Kalaiselvi Murugan',
          },
        })
        await prisma.groceryPurchase.create({
          data: {
            organizationId: org.id,
            propertyId: property.id,
            groceryItemId: item.id,
            quantity,
            unitPrice,
            totalAmount: total,
            vendor: expense.paidTo,
            purchaseDate: date,
            expenseId: expense.id,
            purchasedBy: 'Kalaiselvi Murugan',
          },
        })
      }
    }
  }

  // --------------------------------------------------------- residents ----
  console.log('  residents, check-ins, rent and payments…')

  type ResidentPlan = {
    name: string
    property: typeof mensPg
    bed: BedRow
    joiningDate: Date
    status: 'ACTIVE' | 'NOTICE' | 'CHECKED_OUT'
    payProfile: 'prompt' | 'slow' | 'defaulter'
  }

  const plansList: ResidentPlan[] = []
  const maleNames = [...MALE_NAMES]
  const femaleNames = [...FEMALE_NAMES]

  function planFor(property: typeof mensPg, beds: BedRow[], names: string[], fillRate: number) {
    const shuffled = [...beds].sort(() => rnd() - 0.5)
    const count = Math.min(names.length, Math.round(beds.length * fillRate))
    for (let i = 0; i < count; i++) {
      const monthsAgo = int(0, 9)
      const joiningDate = dayOfMonth(
        addMonths(TODAY, -monthsAgo).getFullYear(),
        addMonths(TODAY, -monthsAgo).getMonth(),
        int(1, 26),
      )
      const roll = rnd()
      plansList.push({
        name: names[i],
        property,
        bed: shuffled[i],
        joiningDate: joiningDate > TODAY ? addMonths(joiningDate, -1) : joiningDate,
        status: roll < 0.88 ? 'ACTIVE' : roll < 0.95 ? 'NOTICE' : 'CHECKED_OUT',
        payProfile: rnd() < 0.68 ? 'prompt' : rnd() < 0.88 ? 'slow' : 'defaulter',
      })
    }
  }

  planFor(mensPg, mensBeds, maleNames, 0.86)
  planFor(womensPg, womensBeds, femaleNames, 0.82)

  let residentSeq = 0
  let invoiceSeq = 0
  let receiptSeq = 0
  const createdResidents: {
    id: string
    name: string
    propertyId: string
    status: string
    userId?: string
    roomNumber: string
    bedLabel: string
  }[] = []

  for (const plan of plansList) {
    residentSeq++
    const code = `RES-${String(residentSeq).padStart(4, '0')}`
    const isStudent = chance(0.35)
    const org1 = isStudent ? pick(COLLEGES) : pick(COMPANIES)
    const rent = plan.bed.rent
    const deposit = plan.property.standardDeposit + (chance(0.3) ? 2000 : 0)
    const foodOptIn = chance(0.85)
    const discount = chance(0.12) ? round(int(300, 1000), 50) : 0

    const checkedOut = plan.status === 'CHECKED_OUT'
    const exitDate = checkedOut ? addDays(TODAY, -int(5, 70)) : null

    // Tenant login for active residents only.
    const tenantEmail = `${code.toLowerCase()}@${org.slug}.stayflow.app`
    let tenantUserId: string | undefined
    if (!checkedOut) {
      const user = await prisma.user.create({
        data: {
          organizationId: org.id,
          email: tenantEmail,
          name: plan.name,
          phone: `98${int(10000000, 99999999)}`,
          passwordHash,
          role: 'TENANT',
          status: 'ACTIVE',
        },
      })
      tenantUserId = user.id
    }

    const phone = `9${int(100000000, 999999999)}`
    const resident = await prisma.resident.create({
      data: {
        organizationId: org.id,
        propertyId: plan.property.id,
        roomId: checkedOut ? null : plan.bed.roomId,
        userId: tenantUserId,
        code,
        fullName: plan.name,
        phone,
        whatsappPhone: phone,
        email: chance(0.7) ? `${plan.name.split(' ')[0].toLowerCase()}${int(10, 99)}@gmail.com` : null,
        dateOfBirth: new Date(int(1994, 2004), int(0, 11), int(1, 28)),
        gender: plan.property.type === 'MENS' ? 'MALE' : 'FEMALE',
        bloodGroup: pick(BLOOD_GROUPS),
        qualification: pick(QUALIFICATIONS),
        permanentAddress: `${int(1, 120)}, ${pick(['Gandhi Street', 'Bharathi Nagar', 'Kamaraj Road', 'Anna Salai', 'Nehru Street'])}`,
        city: pick(CITIES),
        state: 'Tamil Nadu',
        pincode: String(int(600001, 641999)),
        guardianName: `${pick(['R', 'S', 'K', 'M', 'V'])}. ${pick([...MALE_NAMES, ...FEMALE_NAMES]).split(' ')[0]}`,
        guardianRelation: pick(GUARDIAN_RELATIONS),
        guardianPhone: `9${int(100000000, 999999999)}`,
        occupationType: isStudent ? 'STUDENT' : 'WORKING',
        companyName: org1.name,
        companyAddress: org1.address,
        designation: isStudent ? undefined : pick(['Software Engineer', 'Analyst', 'Associate', 'Consultant', 'Staff Nurse', 'Designer']),
        idType: 'AADHAAR',
        idNumber: `${int(2000, 9999)} ${int(1000, 9999)} ${int(1000, 9999)}`,
        kycStatus: chance(0.78) ? 'VERIFIED' : chance(0.5) ? 'PENDING' : 'NOT_SUBMITTED',
        kycVerifiedAt: chance(0.78) ? plan.joiningDate : null,
        status: plan.status,
        joiningDate: plan.joiningDate,
        noticeDate: plan.status === 'NOTICE' ? addDays(TODAY, -int(2, 20)) : null,
        exitDate: plan.status === 'NOTICE' ? addDays(TODAY, int(3, 28)) : exitDate,
        rentAmount: rent,
        depositAmount: deposit,
        maintenanceFee: plan.property.maintenanceFee,
        foodOptIn,
        foodCharge: foodOptIn ? plan.property.foodCharge : 0,
        rentDueDay: 5,
        discountAmount: discount,
        discountNote: discount ? 'Long-stay discount' : null,
      },
    })

    createdResidents.push({
      id: resident.id,
      name: plan.name,
      propertyId: plan.property.id,
      status: plan.status,
      userId: tenantUserId,
      roomNumber: plan.bed.roomNumber,
      bedLabel: plan.bed.label,
    })

    if (!checkedOut) {
      await prisma.bed.update({
        where: { id: plan.bed.id },
        data: { status: 'OCCUPIED', residentId: resident.id },
      })
    }
    await prisma.bedAllocation.create({
      data: {
        bedId: plan.bed.id,
        residentId: resident.id,
        fromDate: plan.joiningDate,
        toDate: exitDate,
      },
    })

    // ---- deposit
    const depositCollected = chance(0.9)
    await prisma.securityDeposit.create({
      data: {
        organizationId: org.id,
        residentId: resident.id,
        amount: deposit,
        collected: depositCollected ? deposit : 0,
        status: checkedOut ? 'REFUNDED' : depositCollected ? 'COLLECTED' : 'PENDING',
        collectedAt: depositCollected ? plan.joiningDate : null,
        refunded: checkedOut ? Math.round(deposit * 0.85) : 0,
        refundedAt: checkedOut ? exitDate : null,
      },
    })

    // ---- food subscription
    if (foodOptIn && !checkedOut) {
      await prisma.foodSubscription.create({
        data: {
          residentId: resident.id,
          foodPlanId: foodPlans.get(plan.property.id)!,
          startDate: plan.joiningDate,
          active: true,
        },
      })
    }

    // ---- invoices + payments, month by month from joining to now
    let ledgerBalance = 0
    const ledgerRows: Prisma.ResidentLedgerCreateManyInput[] = []

    if (depositCollected) {
      ledgerRows.push({
        organizationId: org.id,
        residentId: resident.id,
        kind: 'DEPOSIT',
        label: 'Security deposit received',
        debit: 0,
        credit: 0,
        balance: 0,
        entryDate: plan.joiningDate,
      })
    }

    let cursor = startOfMonth(plan.joiningDate)
    const lastMonth = startOfMonth(exitDate ?? TODAY)

    while (cursor <= lastMonth) {
      const periodStart = new Date(cursor)
      const periodEnd = endOfMonth(periodStart)
      const total = daysInMonth(periodStart)
      const proRated =
        plan.joiningDate > periodStart && plan.joiningDate <= periodEnd
      const billableDays = proRated ? total - plan.joiningDate.getDate() + 1 : total
      const factor = billableDays / total

      const rentLine = Math.round(rent * factor)
      const maintLine = Math.round(plan.property.maintenanceFee * factor)
      const foodLine = foodOptIn ? Math.round(plan.property.foodCharge * factor) : 0
      const subtotal = rentLine + maintLine + foodLine
      const disc = Math.min(discount, subtotal)
      const invoiceTotal = subtotal - disc

      invoiceSeq++
      const stamp = `${periodStart.getFullYear()}${String(periodStart.getMonth() + 1).padStart(2, '0')}`
      const number = `INV-${stamp}-${String(invoiceSeq).padStart(4, '0')}`
      const dueDate = dayOfMonth(periodStart.getFullYear(), periodStart.getMonth(), 5)
      const isCurrentMonth = periodStart.getTime() === startOfMonth(TODAY).getTime()

      // Payment behaviour by profile.
      let paidAmount = invoiceTotal
      let paidAt: Date | null = null
      if (isCurrentMonth) {
        if (plan.payProfile === 'prompt') {
          paidAmount = chance(0.8) ? invoiceTotal : 0
        } else if (plan.payProfile === 'slow') {
          paidAmount = chance(0.45) ? invoiceTotal : chance(0.5) ? Math.round(invoiceTotal * 0.5) : 0
        } else {
          paidAmount = 0
        }
      } else if (plan.payProfile === 'defaulter' && cursor >= startOfMonth(addMonths(TODAY, -1))) {
        paidAmount = chance(0.3) ? Math.round(invoiceTotal * 0.4) : 0
      }

      if (paidAmount > 0) {
        const delay =
          plan.payProfile === 'prompt' ? int(-3, 2) : plan.payProfile === 'slow' ? int(1, 11) : int(8, 20)
        paidAt = addDays(dueDate, delay)
        if (paidAt > TODAY) paidAt = addDays(TODAY, -int(0, 2))
      }

      const overdue = !isCurrentMonth && paidAmount < invoiceTotal && dueDate < TODAY
      const lateFee = overdue && chance(0.5) ? 250 : 0
      const finalTotal = invoiceTotal + lateFee
      const balance = Math.max(0, finalTotal - paidAmount)

      const status =
        balance === 0
          ? 'PAID'
          : paidAmount > 0
            ? 'PARTIALLY_PAID'
            : dueDate < TODAY
              ? 'OVERDUE'
              : 'PENDING'

      const invoice = await prisma.rentInvoice.create({
        data: {
          organizationId: org.id,
          propertyId: plan.property.id,
          residentId: resident.id,
          number,
          periodStart,
          periodEnd,
          issueDate: periodStart < plan.joiningDate ? plan.joiningDate : periodStart,
          dueDate,
          status,
          subtotal,
          discount: disc,
          lateFee,
          total: finalTotal,
          amountPaid: Math.min(paidAmount, finalTotal),
          balance,
          paidAt: balance === 0 ? paidAt : null,
          reminderCount: status === 'OVERDUE' ? int(1, 4) : status === 'PENDING' ? int(0, 1) : 0,
          lastReminderAt: status === 'OVERDUE' ? addDays(TODAY, -int(1, 6)) : null,
          lines: {
            create: [
              {
                kind: 'RENT',
                label: proRated
                  ? `Room rent — ${monthLabel(periodStart)} (${billableDays}/${total} days)`
                  : `Room rent — ${monthLabel(periodStart)}`,
                quantity: 1,
                unitPrice: rentLine,
                amount: rentLine,
              },
              ...(maintLine > 0
                ? [{ kind: 'MAINTENANCE' as const, label: 'Maintenance', quantity: 1, unitPrice: maintLine, amount: maintLine }]
                : []),
              ...(foodLine > 0
                ? [{ kind: 'FOOD' as const, label: 'Food plan', quantity: 1, unitPrice: foodLine, amount: foodLine }]
                : []),
              ...(lateFee > 0
                ? [{ kind: 'LATE_FEE' as const, label: 'Late fee', quantity: 1, unitPrice: lateFee, amount: lateFee }]
                : []),
            ],
          },
        },
      })

      ledgerBalance += finalTotal
      ledgerRows.push({
        organizationId: org.id,
        residentId: resident.id,
        kind: 'CHARGE',
        label: `Invoice ${number} — ${monthLabel(periodStart)}`,
        debit: finalTotal,
        credit: 0,
        balance: ledgerBalance,
        entryDate: invoice.issueDate,
        refType: 'RentInvoice',
        refId: invoice.id,
      })

      if (paidAmount > 0 && paidAt) {
        receiptSeq++
        const receiptNumber = `RCP-${stamp}-${String(receiptSeq).padStart(4, '0')}`
        const method = pick(['UPI', 'UPI', 'UPI', 'CASH', 'BANK_TRANSFER', 'GATEWAY'] as const)
        const payment = await prisma.rentPayment.create({
          data: {
            organizationId: org.id,
            propertyId: plan.property.id,
            residentId: resident.id,
            receiptNumber,
            amount: Math.min(paidAmount, finalTotal),
            method,
            status: 'SUCCESS',
            paidAt,
            reference: method === 'UPI' ? `UPI${int(100000000000, 999999999999)}` : undefined,
            recordedBy: method === 'GATEWAY' ? 'Online payment' : 'Kalaiselvi Murugan',
            isDemo: method === 'GATEWAY',
            gatewayProvider: method === 'GATEWAY' ? 'demo' : undefined,
          },
        })
        await prisma.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId: invoice.id,
            amount: Math.min(paidAmount, finalTotal),
          },
        })
        ledgerBalance -= Math.min(paidAmount, finalTotal)
        ledgerRows.push({
          organizationId: org.id,
          residentId: resident.id,
          kind: 'PAYMENT',
          label: `Payment ${receiptNumber} — ${method.replace('_', ' ').toLowerCase()}`,
          debit: 0,
          credit: Math.min(paidAmount, finalTotal),
          balance: ledgerBalance,
          entryDate: paidAt,
          refType: 'RentPayment',
          refId: payment.id,
        })
      }

      cursor = addMonths(periodStart, 1)
    }

    await prisma.residentLedger.createMany({ data: ledgerRows })

    // ---- checkout record for those who left
    if (checkedOut && exitDate) {
      await prisma.checkout.create({
        data: {
          residentId: resident.id,
          exitDate,
          reason: pick(['Job relocation', 'Course completed', 'Moving closer to office', 'Family reasons']),
          depositHeld: deposit,
          refundAmount: Math.round(deposit * 0.85),
          damageDeduction: Math.round(deposit * 0.15),
          settledAt: exitDate,
          settlementNote: 'Deposit refunded after adjusting dues and minor damages.',
          processedBy: 'Kalaiselvi Murugan',
        },
      })
    }

    // ---- documents
    await prisma.residentDocument.createMany({
      data: [
        { residentId: resident.id, kind: 'AADHAAR', label: 'Aadhaar card', fileUrl: `/demo-documents/${code}-aadhaar.pdf`, verified: true, uploadedAt: plan.joiningDate },
        ...(chance(0.6)
          ? [{ residentId: resident.id, kind: 'AGREEMENT' as const, label: 'Signed admission form', fileUrl: `/demo-documents/${code}-agreement.pdf`, verified: true, uploadedAt: plan.joiningDate }]
          : []),
        ...(isStudent
          ? [{ residentId: resident.id, kind: 'COLLEGE_ID' as const, label: 'College ID card', fileUrl: `/demo-documents/${code}-college-id.jpg`, verified: chance(0.7), uploadedAt: plan.joiningDate }]
          : [{ residentId: resident.id, kind: 'OFFICE_ID' as const, label: 'Employee ID card', fileUrl: `/demo-documents/${code}-office-id.jpg`, verified: chance(0.7), uploadedAt: plan.joiningDate }]),
      ],
    })
  }

  console.log(`    ${createdResidents.length} residents, ${invoiceSeq} invoices, ${receiptSeq} payments`)

  // Give one resident the documented demo login so the README credentials
  // work without hunting for a resident code.
  const demoTenantResident = createdResidents.find((r) => r.status === 'ACTIVE' && r.userId)
  if (demoTenantResident?.userId) {
    await prisma.user.update({
      where: { id: demoTenantResident.userId },
      data: { email: 'tenant@stayflow.app' },
    })
  }

  // Mark a handful of beds as reserved / under maintenance so the bed map
  // shows every state.
  const freeBeds = await prisma.bed.findMany({ where: { status: 'AVAILABLE' }, take: 14 })
  for (const [i, bed] of freeBeds.entries()) {
    if (i % 3 === 0) {
      await prisma.bed.update({ where: { id: bed.id }, data: { status: 'RESERVED', notes: 'Advance paid — joining next week' } })
    } else if (i % 3 === 1) {
      await prisma.bed.update({
        where: { id: bed.id },
        data: { status: 'MAINTENANCE', blockedReason: pick(['Mattress replacement', 'Repainting', 'Cot repair', 'AC servicing']) },
      })
    }
  }

  // ------------------------------------------------------------- meals ----
  console.log('  meals, complaints, expenses and announcements…')

  const activeByProperty = new Map<string, number>()
  for (const property of [mensPg, womensPg]) {
    activeByProperty.set(
      property.id,
      createdResidents.filter((r) => r.propertyId === property.id && r.status !== 'CHECKED_OUT').length,
    )
  }

  const mealRows: Prisma.MealCreateManyInput[] = []
  for (let d = 10; d >= -1; d--) {
    const date = addDays(TODAY, -d)
    for (const property of [mensPg, womensPg]) {
      const base = Math.round((activeByProperty.get(property.id) ?? 0) * 0.85)
      const menus = [
        { type: 'BREAKFAST' as const, menu: BREAKFAST_MENUS[(10 - d + 7) % BREAKFAST_MENUS.length], factor: 0.82 },
        { type: 'LUNCH' as const, menu: LUNCH_MENUS[(10 - d + 7) % LUNCH_MENUS.length], factor: 0.72 },
        { type: 'DINNER' as const, menu: DINNER_MENUS[(10 - d + 7) % DINNER_MENUS.length], factor: 0.9 },
      ]
      for (const meal of menus) {
        const expected = Math.round(base * meal.factor)
        mealRows.push({
          organizationId: org.id,
          propertyId: property.id,
          date,
          type: meal.type,
          menu: meal.menu,
          expectedCount: expected,
          actualCount: d > 0 ? expected - int(0, 6) : null,
          preparedBy: property.id === mensPg.id ? 'Selvi Anandhi' : 'Meena Kumari',
        })
      }
    }
  }
  await prisma.meal.createMany({ data: mealRows })

  // -------------------------------------------------------- complaints ----
  const activeResidents = createdResidents.filter((r) => r.status !== 'CHECKED_OUT')
  const staffByProperty = new Map(
    [mensPg.id, womensPg.id].map((pid) => [pid, staffRows.filter((s) => s.propertyId === pid)]),
  )

  let complaintSeq = 0
  for (let i = 0; i < 34; i++) {
    complaintSeq++
    const resident = pick(activeResidents)
    const template = pick(COMPLAINT_TEMPLATES)
    const createdAt = addDays(TODAY, -int(0, 55))
    const roll = rnd()
    const status =
      roll < 0.2 ? 'OPEN' : roll < 0.32 ? 'ASSIGNED' : roll < 0.44 ? 'IN_PROGRESS' : roll < 0.85 ? 'RESOLVED' : 'CLOSED'
    const assigned = status !== 'OPEN'
    const staff = assigned ? pick(staffByProperty.get(resident.propertyId) ?? staffRows) : null
    const resolvedAt = status === 'RESOLVED' || status === 'CLOSED' ? addDays(createdAt, int(1, 5)) : null

    const residentRow = await prisma.resident.findUnique({
      where: { id: resident.id },
      select: { roomId: true },
    })

    const complaint = await prisma.complaint.create({
      data: {
        organizationId: org.id,
        propertyId: resident.propertyId,
        residentId: resident.id,
        roomId: residentRow?.roomId ?? null,
        code: `CMP-${String(complaintSeq).padStart(4, '0')}`,
        category: template.category as never,
        priority: pick(['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'URGENT'] as const),
        status,
        title: template.title,
        description: template.description,
        assignedStaffId: staff?.id,
        assignedAt: assigned ? addDays(createdAt, 1) : null,
        startedAt: status === 'IN_PROGRESS' || resolvedAt ? addDays(createdAt, 1) : null,
        resolvedAt,
        closedAt: status === 'CLOSED' ? addDays(resolvedAt!, 1) : null,
        resolutionNote: resolvedAt ? pick(['Fixed and tested, working fine now.', 'Replaced the part. Checked with the resident.', 'Cleared the blockage and cleaned up.', 'Serviced and confirmed working.']) : null,
        rating: status === 'CLOSED' ? int(3, 5) : null,
        createdAt,
        updates: {
          create: [
            {
              authorName: resident.name,
              authorRole: 'TENANT',
              message: 'Complaint raised',
              statusTo: 'OPEN',
              createdAt,
            },
            ...(assigned && staff
              ? [
                  {
                    authorName: 'Kalaiselvi Murugan',
                    authorRole: 'MANAGER' as const,
                    message: `Assigned to ${staff.name}`,
                    statusFrom: 'OPEN' as const,
                    statusTo: 'ASSIGNED' as const,
                    createdAt: addDays(createdAt, 1),
                  },
                ]
              : []),
            ...(resolvedAt && staff
              ? [
                  {
                    authorName: staff.name,
                    authorRole: 'WORKER' as const,
                    message: 'Work completed.',
                    statusFrom: 'IN_PROGRESS' as const,
                    statusTo: 'RESOLVED' as const,
                    createdAt: resolvedAt,
                  },
                ]
              : []),
          ],
        },
      },
    })

    if (assigned && staff) {
      await prisma.maintenanceTask.create({
        data: {
          organizationId: org.id,
          propertyId: resident.propertyId,
          roomId: residentRow?.roomId ?? null,
          complaintId: complaint.id,
          title: template.title,
          description: template.description,
          kind: 'COMPLAINT',
          status: resolvedAt ? 'COMPLETED' : status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PENDING',
          priority: complaint.priority,
          assignedStaffId: staff.id,
          dueDate: addDays(createdAt, 3),
          acceptedAt: assigned ? addDays(createdAt, 1) : null,
          startedAt: status === 'IN_PROGRESS' || resolvedAt ? addDays(createdAt, 1) : null,
          completedAt: resolvedAt,
          completionNote: resolvedAt ? 'Completed and verified.' : null,
          createdAt,
        },
      })
    }
  }

  // Standalone (non-complaint) worker tasks so the worker app has a mix.
  for (let i = 0; i < 10; i++) {
    const property = chance(0.5) ? mensPg : womensPg
    const staffList = staffByProperty.get(property.id) ?? staffRows
    await prisma.maintenanceTask.create({
      data: {
        organizationId: org.id,
        propertyId: property.id,
        title: pick([
          'Weekly water tank cleaning',
          'Check all fire extinguishers',
          'Restock bathroom supplies on 2nd floor',
          'Buy vegetables for tomorrow',
          'Service the washing machine',
          'Clean the terrace and staircase',
          'Collect LPG cylinder from agency',
        ]),
        kind: pick(['MAINTENANCE', 'CLEANING', 'GROCERY', 'FOOD'] as const),
        status: pick(['PENDING', 'PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'] as const),
        priority: pick(['LOW', 'MEDIUM', 'HIGH'] as const),
        assignedStaffId: pick(staffList).id,
        dueDate: addDays(TODAY, int(-2, 6)),
        createdAt: addDays(TODAY, -int(0, 10)),
      },
    })
  }

  // ---------------------------------------------------------- expenses ----
  for (let m = 6; m >= 0; m--) {
    const monthDate = addMonths(TODAY, -m)
    for (const property of [mensPg, womensPg]) {
      for (const template of EXPENSE_TEMPLATES) {
        if (m === 0 && monthDate.getDate() < 10 && chance(0.4)) continue
        const category = categoryBySlug.get(template.category)
        if (!category) continue
        const scale = property.id === mensPg.id ? 1 : 0.85
        await prisma.expense.create({
          data: {
            organizationId: org.id,
            propertyId: property.id,
            categoryId: category.id,
            title: template.title,
            amount: round(int(template.min, template.max) * scale, 10),
            spentOn: dayOfMonth(monthDate.getFullYear(), monthDate.getMonth(), int(1, m === 0 ? Math.max(1, TODAY.getDate()) : 28)),
            paidTo: pick(['Tamil Nadu EB', 'Local vendor', 'Service agency', 'Staff payout', VENDORS[0]]),
            paymentMode: pick(['CASH', 'UPI', 'BANK_TRANSFER'] as const),
            recordedBy: 'Kalaiselvi Murugan',
          },
        })
      }
    }
  }

  // ------------------------------------------------- utilities, visitors ----
  for (let m = 3; m >= 1; m--) {
    const monthDate = addMonths(TODAY, -m)
    for (const property of [mensPg, womensPg]) {
      const residents = createdResidents.filter(
        (r) => r.propertyId === property.id && r.status !== 'CHECKED_OUT',
      )
      const totalBill = int(18000, 32000)
      const share = Math.round(totalBill / Math.max(1, residents.length))
      await prisma.utilityCharge.createMany({
        data: residents.map((r) => ({
          organizationId: org.id,
          propertyId: property.id,
          residentId: r.id,
          kind: 'ELECTRICITY',
          periodStart: startOfMonth(monthDate),
          periodEnd: endOfMonth(monthDate),
          unitsUsed: int(30, 70),
          ratePerUnit: 9,
          amount: share,
          billed: m > 1,
        })),
      })
    }
  }

  for (let i = 0; i < 40; i++) {
    const resident = pick(activeResidents)
    const entryAt = addDays(TODAY, -int(0, 25))
    entryAt.setHours(int(9, 19), int(0, 59))
    await prisma.visitor.create({
      data: {
        organizationId: org.id,
        propertyId: resident.propertyId,
        residentId: resident.id,
        name: pick([...MALE_NAMES, ...FEMALE_NAMES]),
        phone: `9${int(100000000, 999999999)}`,
        purpose: pick(VISITOR_PURPOSES),
        relation: pick(['Father', 'Mother', 'Friend', 'Sibling', 'Colleague']),
        entryAt,
        exitAt: chance(0.82) ? new Date(entryAt.getTime() + int(30, 180) * 60000) : null,
        idProof: chance(0.5) ? 'Aadhaar shown' : null,
        recordedBy: 'Gopal Singh',
      },
    })
  }

  // ------------------------------------------------------------ assets ----
  const rooms = await prisma.room.findMany({ select: { id: true, propertyId: true, capacity: true } })
  for (const room of rooms) {
    await prisma.asset.createMany({
      data: [
        { organizationId: org.id, propertyId: room.propertyId, roomId: room.id, name: 'Single Cot', category: 'Furniture', quantity: room.capacity, condition: chance(0.8) ? 'GOOD' : 'FAIR', purchaseCost: 4500 * room.capacity, purchaseDate: addMonths(TODAY, -int(6, 40)) },
        { organizationId: org.id, propertyId: room.propertyId, roomId: room.id, name: 'Mattress', category: 'Furniture', quantity: room.capacity, condition: chance(0.7) ? 'GOOD' : chance(0.5) ? 'FAIR' : 'NEEDS_REPAIR', purchaseCost: 2800 * room.capacity, purchaseDate: addMonths(TODAY, -int(4, 30)) },
        { organizationId: org.id, propertyId: room.propertyId, roomId: room.id, name: 'Ceiling Fan', category: 'Electrical', quantity: room.capacity > 2 ? 2 : 1, condition: 'GOOD', purchaseCost: 1900, purchaseDate: addMonths(TODAY, -int(6, 40)) },
        { organizationId: org.id, propertyId: room.propertyId, roomId: room.id, name: 'Steel Cupboard', category: 'Furniture', quantity: room.capacity, condition: chance(0.75) ? 'GOOD' : 'FAIR', purchaseCost: 6200 * room.capacity, purchaseDate: addMonths(TODAY, -int(6, 40)) },
      ],
    })
  }
  for (const property of [mensPg, womensPg]) {
    await prisma.asset.createMany({
      data: ASSET_TEMPLATES.filter((a) => ['Appliance', 'Security', 'Kitchen'].includes(a.category)).map((a) => ({
        organizationId: org.id,
        propertyId: property.id,
        name: a.name,
        category: a.category,
        quantity: a.category === 'Security' ? int(4, 8) : int(1, 3),
        condition: chance(0.8) ? 'GOOD' : ('NEEDS_REPAIR' as const),
        location: 'Common area',
        purchaseCost: a.cost,
        purchaseDate: addMonths(TODAY, -int(8, 36)),
      })),
    })
  }

  // ---------------------------------------------------- announcements ----
  for (const [i, announcement] of ANNOUNCEMENTS.entries()) {
    const property = i % 2 === 0 ? mensPg : womensPg
    await prisma.announcement.create({
      data: {
        organizationId: org.id,
        propertyId: i < 2 ? null : property.id,
        title: announcement.title,
        body: announcement.body,
        audience: i < 2 ? 'ALL_PROPERTIES' : 'PROPERTY',
        pinned: i === 0,
        publishedAt: addDays(TODAY, -int(1, 20)),
        createdById: owner.id,
        createdByName: owner.name,
      },
    })
  }

  // -------------------------------------------------- outbound messages ----
  const reminderInvoices = await prisma.rentInvoice.findMany({
    where: { status: { in: ['OVERDUE', 'PENDING'] } },
    include: { resident: true, property: true },
    take: 22,
  })
  for (const invoice of reminderInvoices) {
    const overdue = invoice.status === 'OVERDUE'
    await prisma.outboundMessage.create({
      data: {
        organizationId: org.id,
        channel: 'WHATSAPP',
        provider: 'demo',
        toName: invoice.resident.fullName,
        toAddress: `91${invoice.resident.phone.slice(-10)}`,
        template: overdue ? 'rent_reminder_overdue' : 'rent_reminder_upcoming',
        body:
          `Hi ${invoice.resident.fullName.split(' ')[0]} 👋\n\n` +
          (overdue
            ? `Your PG rent of ${money(invoice.balance)} was due on ${invoice.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })} and is now overdue.`
            : `Your PG rent of ${money(invoice.balance)} is due on ${invoice.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.`) +
          `\n\nPG: ${invoice.property.name}\nAmount: ${money(invoice.balance)}\n\nThank you.`,
        status: 'DEMO_NOT_SENT',
        isDemo: true,
        refType: 'RentInvoice',
        refId: invoice.id,
        createdAt: addDays(TODAY, -int(0, 8)),
      },
    })
  }

  // ------------------------------------------------------ notifications ----
  const notifications: Prisma.NotificationCreateManyInput[] = []
  const openComplaints = await prisma.complaint.findMany({
    where: { status: { in: ['OPEN', 'ASSIGNED'] } },
    take: 6,
    include: { property: true },
  })
  for (const complaint of openComplaints) {
    for (const userId of [owner.id, manager.id]) {
      notifications.push({
        userId,
        organizationId: org.id,
        kind: 'COMPLAINT',
        title: `New ${complaint.priority.toLowerCase()} priority complaint`,
        body: `${complaint.code} · ${complaint.title} at ${complaint.property.name}`,
        link: `/app/complaints/${complaint.id}`,
        createdAt: complaint.createdAt,
        readAt: chance(0.35) ? addDays(complaint.createdAt, 1) : null,
      })
    }
  }
  const recentPayments = await prisma.rentPayment.findMany({
    orderBy: { paidAt: 'desc' },
    take: 6,
    include: { resident: true },
  })
  for (const payment of recentPayments) {
    notifications.push({
      userId: owner.id,
      organizationId: org.id,
      kind: 'PAYMENT',
      title: 'Rent payment received',
      body: `${payment.resident.fullName} paid ${money(payment.amount)} — receipt ${payment.receiptNumber}.`,
      link: '/app/payments',
      createdAt: payment.paidAt,
      readAt: chance(0.5) ? new Date() : null,
    })
  }
  const lowStock = await prisma.groceryItem.findMany({ take: 40 })
  for (const item of lowStock.filter((i) => i.currentStock <= i.minimumStock).slice(0, 4)) {
    notifications.push({
      userId: owner.id,
      organizationId: org.id,
      kind: 'GROCERY',
      title: 'Low stock',
      body: `${item.name} is down to ${item.currentStock} (minimum ${item.minimumStock}).`,
      link: '/app/grocery',
      createdAt: addDays(TODAY, -int(0, 3)),
    })
  }
  // Tenants get their own notifications.
  for (const resident of activeResidents.slice(0, 25)) {
    if (!resident.userId) continue
    notifications.push({
      userId: resident.userId,
      organizationId: org.id,
      kind: 'RENT',
      title: `Rent for ${monthLabel(TODAY)}`,
      body: 'Your rent invoice is ready in the app.',
      link: '/tenant/rent',
      createdAt: addDays(TODAY, -int(1, 8)),
      readAt: chance(0.4) ? new Date() : null,
    })
  }
  await prisma.notification.createMany({ data: notifications })

  // ----------------------------------------------------- activity logs ----
  const logs: Prisma.ActivityLogCreateManyInput[] = []
  logs.push(
    {
      organizationId: org.id,
      propertyId: mensPg.id,
      actorId: owner.id,
      actorName: owner.name,
      actorRole: 'OWNER',
      event: 'PROPERTY_CREATED',
      entityType: 'Property',
      entityId: mensPg.id,
      summary: `${mensPg.name} created with ${mensBeds.length} beds`,
      createdAt: addMonths(TODAY, -10),
    },
    {
      organizationId: org.id,
      propertyId: womensPg.id,
      actorId: owner.id,
      actorName: owner.name,
      actorRole: 'OWNER',
      event: 'PROPERTY_CREATED',
      entityType: 'Property',
      entityId: womensPg.id,
      summary: `${womensPg.name} created with ${womensBeds.length} beds`,
      createdAt: addMonths(TODAY, -10),
    },
  )
  const recentResidents = await prisma.resident.findMany({
    orderBy: { joiningDate: 'desc' },
    take: 14,
    include: { property: true, bed: { include: { room: true } } },
  })
  for (const resident of recentResidents) {
    logs.push({
      organizationId: org.id,
      propertyId: resident.propertyId,
      actorId: manager.id,
      actorName: manager.name,
      actorRole: 'MANAGER',
      event: 'RESIDENT_CHECKED_IN',
      entityType: 'Resident',
      entityId: resident.id,
      summary: `${resident.fullName} checked into ${resident.property.name}${resident.bed ? ` · Room ${resident.bed.room.number} · Bed ${resident.bed.label}` : ''}`,
      createdAt: resident.joiningDate,
    })
  }
  for (const payment of recentPayments) {
    logs.push({
      organizationId: org.id,
      actorName: payment.recordedBy ?? 'System',
      actorRole: 'MANAGER',
      event: 'PAYMENT_COMPLETED',
      entityType: 'RentPayment',
      entityId: payment.id,
      summary: `${money(payment.amount)} from ${payment.resident.fullName} (${payment.receiptNumber})`,
      createdAt: payment.paidAt,
    })
  }
  const recentComplaints = await prisma.complaint.findMany({ orderBy: { createdAt: 'desc' }, take: 12 })
  for (const complaint of recentComplaints) {
    logs.push({
      organizationId: org.id,
      propertyId: complaint.propertyId,
      actorName: 'Resident',
      actorRole: 'TENANT',
      event: 'COMPLAINT_CREATED',
      entityType: 'Complaint',
      entityId: complaint.id,
      summary: `${complaint.code} · ${complaint.title}`,
      createdAt: complaint.createdAt,
    })
    if (complaint.resolvedAt) {
      logs.push({
        organizationId: org.id,
        propertyId: complaint.propertyId,
        actorName: 'Worker',
        actorRole: 'WORKER',
        event: 'COMPLAINT_RESOLVED',
        entityType: 'Complaint',
        entityId: complaint.id,
        summary: `${complaint.code} · ${complaint.title} → resolved`,
        createdAt: complaint.resolvedAt,
      })
    }
  }
  await prisma.activityLog.createMany({ data: logs })

  // ------------------------------------------- occupancy snapshots ----
  for (const property of [mensPg, womensPg]) {
    const beds = await prisma.bed.count({ where: { propertyId: property.id } })
    const occupiedNow = await prisma.bed.count({ where: { propertyId: property.id, status: 'OCCUPIED' } })
    for (let d = 44; d >= 0; d--) {
      const date = addDays(TODAY, -d)
      // Walk backwards from today with small, believable variation.
      const drift = Math.round(Math.sin(d / 7) * 3) + (d > 30 ? -3 : 0)
      const occupied = Math.max(0, Math.min(beds, occupiedNow + drift - (d === 0 ? 0 : int(0, 2))))
      await prisma.occupancySnapshot.create({
        data: {
          propertyId: property.id,
          date,
          totalBeds: beds,
          occupied: d === 0 ? occupiedNow : occupied,
          vacant: beds - (d === 0 ? occupiedNow : occupied),
          reserved: int(1, 4),
          maintenance: int(1, 3),
        },
      })
    }
  }

  // ------------------------------------------------- subscriptions ----
  console.log('  subscriptions and platform billing…')
  for (const property of [mensPg, womensPg]) {
    const amount = property.standardRent // Growth plan = 100% of standard rent
    const periodStart = startOfMonth(TODAY)
    const subscription = await prisma.subscription.create({
      data: {
        organizationId: org.id,
        propertyId: property.id,
        planId: plans.growth.id,
        status: 'ACTIVE',
        amount,
        startedAt: addMonths(TODAY, -10),
        currentPeriodStart: periodStart,
        currentPeriodEnd: addMonths(periodStart, 1),
        nextBillingDate: addMonths(periodStart, 1),
        autopayEnabled: true,
        mandateStatus: 'ACTIVE',
        mandateRef: `demo_mandate_${property.code.toLowerCase()}`,
        mandateSetupAt: addMonths(TODAY, -10),
        paymentMethods: {
          create: {
            kind: 'UPI_AUTOPAY',
            label: 'UPI AutoPay — ICICI ••4421',
            maskedRef: 'stayflowdemo@okicici',
            isDefault: true,
            status: 'ACTIVE',
          },
        },
      },
    })

    for (let m = 5; m >= 0; m--) {
      const start = startOfMonth(addMonths(TODAY, -m))
      const number = `SF-${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, '0')}-${property.code}`
      const paid = m > 0 || TODAY.getDate() >= 3
      const invoice = await prisma.subscriptionInvoice.create({
        data: {
          subscriptionId: subscription.id,
          number,
          periodStart: start,
          periodEnd: endOfMonth(start),
          issueDate: start,
          dueDate: addDays(start, 3),
          amount,
          total: amount,
          amountPaid: paid ? amount : 0,
          status: paid ? 'PAID' : 'PENDING',
          paidAt: paid ? addDays(start, 1) : null,
        },
      })
      if (paid) {
        await prisma.subscriptionPayment.create({
          data: {
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            amount,
            status: 'SUCCESS',
            method: 'GATEWAY',
            paidAt: addDays(start, 1),
            gatewayProvider: 'demo',
            isDemo: true,
          },
        })
      }
    }
  }

  // A second organisation so the Super Admin view is not a single row.
  const org2 = await prisma.organization.create({
    data: {
      name: 'Sree Balaji Hostels',
      slug: 'sree-balaji',
      ownerName: 'Ramesh Krishnan',
      contactEmail: 'ramesh@sreebalaji.example',
      contactPhone: '9840012345',
      city: 'Chennai',
      state: 'Tamil Nadu',
      status: 'TRIAL',
      trialEndsAt: addDays(TODAY, 6),
      settings: { create: {} },
      users: {
        create: {
          email: 'ramesh@sreebalaji.example',
          name: 'Ramesh Krishnan',
          phone: '9840012345',
          passwordHash,
          role: 'OWNER',
        },
      },
    },
  })
  const org2Property = await prisma.property.create({
    data: {
      organizationId: org2.id,
      name: 'Sree Balaji Mens PG',
      code: 'SBM',
      type: 'MENS',
      addressLine: '12, Velachery Main Road',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600042',
      standardRent: 7500,
      standardDeposit: 9000,
    },
  })
  await prisma.subscription.create({
    data: {
      organizationId: org2.id,
      propertyId: org2Property.id,
      planId: plans.starter.id,
      status: 'TRIALING',
      amount: 7500,
      startedAt: addDays(TODAY, -8),
      trialEndsAt: addDays(TODAY, 6),
      currentPeriodStart: addDays(TODAY, -8),
      currentPeriodEnd: addDays(TODAY, 22),
      nextBillingDate: addDays(TODAY, 6),
    },
  })

  const org3 = await prisma.organization.create({
    data: {
      name: 'Noor Ladies Hostel',
      slug: 'noor-ladies',
      ownerName: 'Fathima Beevi',
      contactEmail: 'fathima@noorhostel.example',
      contactPhone: '9789054321',
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      status: 'PAST_DUE',
      settings: { create: {} },
      users: {
        create: {
          email: 'fathima@noorhostel.example',
          name: 'Fathima Beevi',
          phone: '9789054321',
          passwordHash,
          role: 'OWNER',
        },
      },
    },
  })
  const org3Property = await prisma.property.create({
    data: {
      organizationId: org3.id,
      name: 'Noor Ladies Hostel',
      code: 'NLH',
      type: 'WOMENS',
      addressLine: '7, Race Course Road',
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      pincode: '641018',
      standardRent: 6800,
      standardDeposit: 8000,
    },
  })
  const org3Sub = await prisma.subscription.create({
    data: {
      organizationId: org3.id,
      propertyId: org3Property.id,
      planId: plans.growth.id,
      status: 'GRACE',
      amount: 6800,
      startedAt: addMonths(TODAY, -4),
      currentPeriodStart: startOfMonth(TODAY),
      currentPeriodEnd: addMonths(startOfMonth(TODAY), 1),
      nextBillingDate: addMonths(startOfMonth(TODAY), 1),
      graceEndsAt: addDays(TODAY, 3),
      autopayEnabled: true,
      mandateStatus: 'ACTIVE',
    },
  })
  const org3Invoice = await prisma.subscriptionInvoice.create({
    data: {
      subscriptionId: org3Sub.id,
      number: `SF-${startOfMonth(TODAY).getFullYear()}${String(startOfMonth(TODAY).getMonth() + 1).padStart(2, '0')}-NLH`,
      periodStart: startOfMonth(TODAY),
      periodEnd: endOfMonth(TODAY),
      issueDate: startOfMonth(TODAY),
      dueDate: addDays(startOfMonth(TODAY), 3),
      amount: 6800,
      total: 6800,
      status: 'OVERDUE',
    },
  })
  await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: org3Sub.id,
      invoiceId: org3Invoice.id,
      amount: 6800,
      status: 'FAILED',
      method: 'GATEWAY',
      failureReason: 'Insufficient balance (demo simulation)',
      retryCount: 2,
      gatewayProvider: 'demo',
      isDemo: true,
    },
  })

  // -------------------------------------------------------------- leads ----
  console.log('  website leads…')
  for (const [i, lead] of LEADS.entries()) {
    const created = await prisma.lead.create({
      data: {
        name: lead.name,
        phone: lead.phone,
        whatsapp: lead.phone,
        email: `${lead.name.split(' ')[0].toLowerCase()}@example.com`,
        pgName: lead.pgName,
        pgCount: lead.pgCount,
        pgTypes: lead.pgTypes,
        bedCount: lead.bedCount,
        rentRange: lead.rentRange,
        currentMethod: lead.currentMethod,
        city: lead.city,
        message: lead.message,
        status: lead.status as never,
        source: 'website',
        createdAt: addDays(TODAY, -int(1, 30)),
        lastContactedAt: lead.status === 'NEW' ? null : addDays(TODAY, -int(1, 10)),
        demoAt:
          lead.status === 'DEMO_SCHEDULED'
            ? addDays(TODAY, int(1, 5))
            : lead.status === 'DEMO_COMPLETED'
              ? addDays(TODAY, -int(2, 8))
              : null,
      },
    })
    if (lead.status !== 'NEW') {
      await prisma.leadNote.create({
        data: {
          leadId: created.id,
          authorName: superAdmin.name,
          body: pick([
            'Called and explained the automation flow. Wants to see the resident app.',
            'Sent the pricing example over WhatsApp. Following up next week.',
            'Demo booked. Needs the food and grocery module walkthrough.',
            'Not ready this quarter. Revisit after the new academic year.',
          ]),
          statusTo: lead.status as never,
          createdAt: addDays(TODAY, -int(1, 9)),
        },
      })
    }
    if (i === 0) {
      await prisma.notification.create({
        data: {
          userId: superAdmin.id,
          kind: 'LEAD',
          title: 'New demo request',
          body: `${lead.name} · ${lead.pgName} · ${lead.city}`,
          link: '/admin/leads',
          createdAt: created.createdAt,
        },
      })
    }
  }

  // ------------------------------------------------------------ summary ----
  const counts = {
    organizations: await prisma.organization.count(),
    properties: await prisma.property.count(),
    rooms: await prisma.room.count(),
    beds: await prisma.bed.count(),
    residents: await prisma.resident.count(),
    invoices: await prisma.rentInvoice.count(),
    payments: await prisma.rentPayment.count(),
    complaints: await prisma.complaint.count(),
    expenses: await prisma.expense.count(),
    staff: await prisma.staff.count(),
    leads: await prisma.lead.count(),
  }

  console.log('─'.repeat(40))
  console.table(counts)
  console.log(`\nDemo logins (password: ${PASSWORD})`)
  console.log('  Super Admin  admin@stayflow.app')
  console.log('  PG Owner     owner@stayflow.app')
  console.log('  Manager      manager@stayflow.app')
  console.log('  Worker       worker@stayflow.app')
  const demoTenant = await prisma.resident.findFirst({
    where: { status: 'ACTIVE', userId: { not: null } },
    include: { user: true },
    orderBy: { code: 'asc' },
  })
  console.log(`  Resident     ${demoTenant?.user?.email}`)
  console.log('')
}

main()
  .catch((error) => {
    console.error('\nSeed failed:\n', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
