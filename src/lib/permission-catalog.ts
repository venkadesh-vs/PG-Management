import type { ModuleKey } from './modules'

/**
 * Everything a role can be allowed to do, grouped by module so the role
 * editor can show one row per module. The owner always has all of them.
 * Keys are stored on OrgRole.permissions — rename a key only with a migration.
 */

export type PermissionDef = { key: string; label: string; hint?: string }
export type PermissionGroup = { module: ModuleKey; label: string; permissions: PermissionDef[] }

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    module: 'dashboard',
    label: 'Dashboard',
    permissions: [{ key: 'dashboard.view', label: 'See the dashboard and money summary' }],
  },
  {
    module: 'properties',
    label: 'PGs, rooms & beds',
    permissions: [
      { key: 'properties.view', label: 'See PGs, rooms and the bed map' },
      { key: 'properties.manage', label: 'Edit PG details, rooms and beds' },
      { key: 'properties.create', label: 'Add a new PG', hint: 'Each PG adds to your subscription' },
    ],
  },
  {
    module: 'residents',
    label: 'Residents',
    permissions: [
      { key: 'residents.view', label: 'See residents and their details' },
      { key: 'residents.manage', label: 'Check in, edit and move residents' },
      { key: 'residents.checkout', label: 'Check out and settle deposits' },
      { key: 'residents.kyc', label: 'See full ID numbers and documents' },
    ],
  },
  {
    module: 'leads',
    label: 'Enquiries & bookings',
    permissions: [
      { key: 'leads.view', label: 'See enquiries and bookings' },
      { key: 'leads.manage', label: 'Add enquiries, log calls and visits' },
      { key: 'bookings.manage', label: 'Reserve beds, take tokens and cancel bookings' },
    ],
  },
  {
    module: 'rent',
    label: 'Rent & payments',
    permissions: [
      { key: 'rent.view', label: 'See invoices, dues and payments' },
      { key: 'payments.record', label: 'Record payments and send reminders' },
      { key: 'rent.manage', label: 'Generate invoices and add charges' },
      { key: 'invoices.waive', label: 'Waive invoices and late fees' },
    ],
  },
  {
    module: 'expenses',
    label: 'Expenses',
    permissions: [
      { key: 'expenses.view', label: 'See expenses' },
      { key: 'expenses.manage', label: 'Add, edit and delete expenses' },
    ],
  },
  {
    module: 'complaints',
    label: 'Complaints & maintenance',
    permissions: [
      { key: 'complaints.view', label: 'See complaints and tasks' },
      { key: 'complaints.manage', label: 'Raise, update and close complaints' },
      { key: 'complaints.assign', label: 'Assign complaints and tasks to staff' },
      { key: 'tasks.work', label: 'Work on tasks assigned to them', hint: 'For the staff app' },
    ],
  },
  {
    module: 'food',
    label: 'Food & meals',
    permissions: [
      { key: 'food.view', label: 'See menus and meal counts' },
      { key: 'food.manage', label: 'Plan menus and mark meals served' },
    ],
  },
  {
    module: 'grocery',
    label: 'Grocery & stock',
    permissions: [
      { key: 'grocery.view', label: 'See stock and the shopping list' },
      { key: 'grocery.manage', label: 'Record purchases and update stock' },
    ],
  },
  {
    module: 'inventory',
    label: 'Inventory & assets',
    permissions: [
      { key: 'inventory.view', label: 'See assets' },
      { key: 'inventory.manage', label: 'Add, edit and remove assets' },
    ],
  },
  {
    module: 'staff',
    label: 'Staff & attendance',
    permissions: [
      { key: 'staff.view', label: 'See staff and attendance' },
      { key: 'staff.manage', label: 'Add and edit staff, mark attendance' },
      { key: 'attendance.self', label: 'Mark their own attendance', hint: 'For the staff app' },
    ],
  },
  {
    module: 'visitors',
    label: 'Visitor log',
    permissions: [
      { key: 'visitors.view', label: 'See the visitor log' },
      { key: 'visitors.manage', label: 'Sign visitors in and out' },
    ],
  },
  {
    module: 'requests',
    label: 'Resident requests',
    permissions: [
      { key: 'requests.view', label: 'See resident requests' },
      { key: 'requests.manage', label: 'Approve or reject requests' },
    ],
  },
  {
    module: 'announcements',
    label: 'Announcements',
    permissions: [{ key: 'announcements.send', label: 'Send announcements to residents' }],
  },
  {
    module: 'whatsapp',
    label: 'WhatsApp messages',
    permissions: [{ key: 'messages.view', label: 'See sent messages and retry failed ones' }],
  },
  {
    module: 'reports',
    label: 'Reports',
    permissions: [
      { key: 'reports.view', label: 'See reports' },
      { key: 'reports.export', label: 'Download CSV exports' },
    ],
  },
  {
    module: 'activity',
    label: 'Activity log',
    permissions: [{ key: 'activity.view', label: 'See the activity log' }],
  },
  {
    module: 'settings',
    label: 'Settings & billing',
    permissions: [
      { key: 'settings.manage', label: 'Change rent rules, reminders and integrations' },
      { key: 'team.manage', label: 'Invite people, edit roles and switch features' },
      { key: 'billing.manage', label: 'Manage the StayFlow subscription and pay invoices' },
    ],
  },
]

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key))
export type PermissionKey = string

/** Which module a permission belongs to, so a switched-off module grants nothing. */
export const MODULE_OF_PERMISSION: Record<string, ModuleKey> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.key, g.module])),
)

/**
 * Starting roles every organization gets. The owner can edit, rename or
 * delete them (when unused) and add their own.
 */
export const ROLE_TEMPLATES: {
  name: string
  description: string
  app: 'DASHBOARD' | 'STAFF_APP'
  color: string
  permissions: string[]
}[] = [
  {
    name: 'Manager',
    description: 'Runs day-to-day operations. Cannot change billing, the team or settings.',
    app: 'DASHBOARD',
    color: 'blue',
    permissions: ALL_PERMISSIONS.filter(
      (k) => !['properties.create', 'invoices.waive', 'settings.manage', 'team.manage', 'billing.manage', 'tasks.work', 'attendance.self'].includes(k),
    ),
  },
  {
    name: 'Accountant',
    description: 'Rent, payments, expenses and reports only.',
    app: 'DASHBOARD',
    color: 'emerald',
    permissions: ['dashboard.view', 'residents.view', 'rent.view', 'payments.record', 'rent.manage', 'expenses.view', 'expenses.manage', 'reports.view', 'reports.export'],
  },
  {
    name: 'Warden',
    description: 'Looks after residents: check-ins, complaints, visitors and notices.',
    app: 'DASHBOARD',
    color: 'violet',
    permissions: ['dashboard.view', 'properties.view', 'residents.view', 'residents.manage', 'requests.view', 'requests.manage', 'leads.view', 'leads.manage', 'bookings.manage', 'complaints.view', 'complaints.manage', 'complaints.assign', 'visitors.view', 'visitors.manage', 'announcements.send', 'food.view'],
  },
  {
    name: 'Cook',
    description: 'Kitchen staff: menu, meals served and grocery stock, on the staff app.',
    app: 'STAFF_APP',
    color: 'amber',
    permissions: ['food.view', 'food.manage', 'grocery.view', 'grocery.manage', 'attendance.self'],
  },
  {
    name: 'General staff',
    description: 'All-round staff: tasks, kitchen, grocery and attendance, on the staff app.',
    app: 'STAFF_APP',
    color: 'slate',
    permissions: ['tasks.work', 'food.view', 'food.manage', 'grocery.view', 'grocery.manage', 'attendance.self'],
  },
  {
    name: 'Housekeeping',
    description: 'Cleaning and maintenance tasks, on the staff app.',
    app: 'STAFF_APP',
    color: 'sky',
    permissions: ['tasks.work', 'attendance.self'],
  },
]

/** Default lists for each editable dropdown ("lookups"). */
export const LOOKUP_TYPES: { type: string; label: string; description: string; defaults: [string, string][] }[] = [
  {
    type: 'COMPLAINT_CATEGORY',
    label: 'Complaint categories',
    description: 'What residents can choose when they raise a complaint.',
    defaults: [
      ['PLUMBING', 'Plumbing'], ['ELECTRICITY', 'Electricity'], ['AC', 'AC'], ['FAN', 'Fan'], ['BATHROOM', 'Bathroom'],
      ['CLEANING', 'Cleaning'], ['INTERNET', 'Wi-Fi / Internet'], ['FOOD', 'Food'], ['ROOM', 'Room'],
      ['FURNITURE', 'Furniture'], ['SECURITY', 'Security'], ['OTHER', 'Other'],
    ],
  },
  {
    type: 'STAFF_ROLE',
    label: 'Staff job titles',
    description: 'Job titles shown on staff records.',
    defaults: [
      ['MANAGER', 'Manager'], ['COOK', 'Cook'], ['KITCHEN_HELPER', 'Kitchen helper'], ['CLEANER', 'Cleaner'],
      ['SECURITY', 'Security'], ['ELECTRICIAN', 'Electrician'], ['PLUMBER', 'Plumber'], ['MAINTENANCE', 'Maintenance'], ['OTHER', 'Other'],
    ],
  },
  {
    type: 'ID_TYPE',
    label: 'ID proof types',
    description: 'ID documents accepted at check-in.',
    defaults: [['AADHAAR', 'Aadhaar'], ['PAN', 'PAN card'], ['PASSPORT', 'Passport'], ['DRIVING_LICENCE', 'Driving licence'], ['VOTER_ID', 'Voter ID']],
  },
  {
    type: 'GUARDIAN_RELATION',
    label: 'Guardian relations',
    description: 'Relationship of the emergency contact.',
    defaults: [['FATHER', 'Father'], ['MOTHER', 'Mother'], ['BROTHER', 'Brother'], ['SISTER', 'Sister'], ['SPOUSE', 'Spouse'], ['RELATIVE', 'Relative'], ['FRIEND', 'Friend'], ['OTHER', 'Other']],
  },
  {
    type: 'VISITOR_PURPOSE',
    label: 'Visitor purposes',
    description: 'Reasons recorded in the visitor log.',
    defaults: [['FAMILY', 'Family visit'], ['FRIEND', 'Friend'], ['DELIVERY', 'Delivery'], ['MAINTENANCE', 'Maintenance / repair'], ['OFFICIAL', 'Official'], ['OTHER', 'Other']],
  },
]
