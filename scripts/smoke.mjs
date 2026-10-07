/**
 * End-to-end smoke test.
 *
 * Signs in as each role, walks every route, and exercises the core write
 * workflows (check-in, payment, complaint assignment, worker completion,
 * resident payment) against a running server.
 *
 * Usage: node scripts/smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://localhost:3100'
const PASSWORD = process.env.SEED_PASSWORD ?? 'StayFlow@2026'

let passed = 0
let failed = 0
const failures = []

function log(ok, label, detail = '') {
  if (ok) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? ` \x1b[90m${detail}\x1b[0m` : ''}`)
  } else {
    failed++
    failures.push(`${label} ${detail}`)
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` \x1b[90m${detail}\x1b[0m` : ''}`)
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

/** A tiny cookie jar, one per signed-in role. */
function makeSession() {
  let cookie = ''
  return {
    get cookie() {
      return cookie
    },
    async fetch(path, init = {}) {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        redirect: 'manual',
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
          ...init.headers,
        },
      })
      const setCookie = res.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      return res
    },
  }
}

async function signIn(email) {
  const session = makeSession()
  const res = await session.fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const body = await res.json().catch(() => ({}))
  log(res.status === 200, `sign in as ${email}`, res.status === 200 ? body.redirectTo : `HTTP ${res.status}`)
  return session
}

async function checkPages(session, label, paths) {
  for (const path of paths) {
    const res = await session.fetch(path)
    const ok = res.status === 200
    log(ok, `${label} ${path}`, ok ? '' : `HTTP ${res.status}`)
  }
}

async function main() {
  console.log(`\n\x1b[1mStayFlow smoke test\x1b[0m  →  ${BASE}\n${'─'.repeat(52)}`)

  // ---------------------------------------------------------- public ----
  section('Public site')
  for (const path of ['/', '/login', '/privacy', '/terms', '/sitemap.xml', '/robots.txt']) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
    log(res.status === 200, `GET ${path}`, res.status === 200 ? '' : `HTTP ${res.status}`)
  }

  // Auth is actually enforced, not just hidden in the UI.
  for (const path of ['/app', '/admin', '/tenant', '/worker']) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
    const guarded = res.status === 307 || res.status === 302 || res.status === 308
    log(guarded, `${path} redirects when signed out`, guarded ? '' : `HTTP ${res.status}`)
  }

  const badLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@stayflow.app', password: 'wrong-password' }),
  })
  log(badLogin.status === 401, 'wrong password is rejected', `HTTP ${badLogin.status}`)

  // ------------------------------------------------------------ owner ----
  section('PG owner')
  const owner = await signIn('owner@stayflow.app')
  await checkPages(owner, 'owner', [
    '/app',
    '/app/properties',
    '/app/properties/new',
    '/app/beds',
    '/app/residents',
    '/app/residents/new',
    '/app/rent',
    '/app/payments',
    '/app/expenses',
    '/app/complaints',
    '/app/food',
    '/app/grocery',
    '/app/staff',
    '/app/visitors',
    '/app/inventory',
    '/app/announcements',
    '/app/reports',
    '/app/activity',
    '/app/messages',
    '/app/notifications',
    '/app/subscription',
    '/app/settings',
  ])

  // Detail routes need real ids.
  const propsRes = await owner.fetch('/api/properties')
  const { properties } = await propsRes.json()
  const property = properties[0]
  log(Boolean(property), 'GET /api/properties', property ? `${properties.length} PGs` : 'none')

  const residentsRes = await owner.fetch('/api/residents')
  const { residents } = await residentsRes.json()
  const resident = residents[0]
  log(Boolean(resident), 'GET /api/residents', resident ? `${residents.length} residents` : 'none')

  if (property) await checkPages(owner, 'owner', [`/app/properties/${property.id}`])
  if (resident) await checkPages(owner, 'owner', [`/app/residents/${resident.id}`])

  const searchRes = await owner.fetch('/api/search?q=arun')
  const searchBody = await searchRes.json().catch(() => ({ results: [] }))
  log(searchRes.status === 200, 'global search', `${searchBody.results?.length ?? 0} results`)

  // ------------------------------------------------- check-in workflow ----
  section('Workflow: check in a resident')
  let newResidentId = null
  if (property) {
    // Any PG with a free bed will do; the first one may be full.
    let bed = null
    let bedProperty = property
    for (const candidate of properties) {
      const roomsRes = await owner.fetch(`/api/rooms?propertyId=${candidate.id}&available=1`)
      const { floors } = await roomsRes.json()
      bed = floors
        .flatMap((f) => f.rooms)
        .flatMap((r) => r.beds)
        .find((b) => b.status === 'AVAILABLE')
      if (bed) {
        bedProperty = candidate
        break
      }
    }
    log(Boolean(bed), 'found an available bed', bed ? `bed ${bed.label}` : 'none free')

    if (bed) {
      const res = await owner.fetch('/api/residents', {
        method: 'POST',
        body: JSON.stringify({
          fullName: 'Smoke Test Resident',
          phone: '9876500099',
          propertyId: bedProperty.id,
          bedId: bed.id,
          joiningDate: new Date().toISOString().slice(0, 10),
          rentAmount: 8500,
          depositAmount: 10000,
          maintenanceFee: 300,
          foodOptIn: true,
          foodCharge: 2500,
          rentDueDay: 5,
          depositCollected: true,
          createTenantAccount: true,
          guardianName: 'Test Guardian',
          guardianPhone: '9876500098',
          idType: 'AADHAAR',
          idNumber: '1111 2222 3333',
        }),
      })
      const body = await res.json()
      const ok = res.status === 201
      log(ok, 'check-in creates the resident', ok ? body.resident.code : JSON.stringify(body))
      if (ok) {
        newResidentId = body.resident.id
        log(Boolean(body.bed?.label), 'bed allocated', `room ${body.bed?.room} bed ${body.bed?.label}`)
        log(Boolean(body.invoice), 'first invoice generated', body.invoice?.number ?? 'none')
        log(Boolean(body.tenantLogin), 'resident app account created', body.tenantLogin?.email ?? 'none')
      }

      // The same bed must now be refused.
      const dupe = await owner.fetch('/api/residents', {
        method: 'POST',
        body: JSON.stringify({
          fullName: 'Second Person',
          phone: '9876500097',
          propertyId: bedProperty.id,
          bedId: bed.id,
          joiningDate: new Date().toISOString().slice(0, 10),
          rentAmount: 8000,
          depositAmount: 10000,
          rentDueDay: 5,
        }),
      })
      log(dupe.status === 409, 'occupied bed is refused', `HTTP ${dupe.status}`)
    }
  }

  // ------------------------------------------------- payment workflow ----
  section('Workflow: record a payment')
  if (newResidentId) {
    const res = await owner.fetch('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        residentId: newResidentId,
        amount: 5000,
        method: 'UPI',
        reference: 'SMOKE-TEST',
      }),
    })
    const body = await res.json()
    log(res.status === 201, 'payment recorded', body.receiptNumber ?? JSON.stringify(body))
    log(Array.isArray(body.allocations), 'allocated to invoices', `${body.allocations?.length ?? 0} invoice(s)`)

    const zero = await owner.fetch('/api/payments', {
      method: 'POST',
      body: JSON.stringify({ residentId: newResidentId, amount: 0, method: 'CASH' }),
    })
    log(zero.status === 422, 'zero-amount payment is refused', `HTTP ${zero.status}`)
  }

  // ------------------------------------------------ complaint workflow ----
  section('Workflow: complaint → worker → resolved')
  let complaintId = null
  // The resident must live in the PG the complaint is raised for.
  const complaintResident = residents.find((r) => r.property?.id === property?.id) ?? null
  if (property && complaintResident) {
    const created = await owner.fetch('/api/complaints', {
      method: 'POST',
      body: JSON.stringify({
        propertyId: property.id,
        residentId: complaintResident.id,
        category: 'PLUMBING',
        priority: 'HIGH',
        title: 'Smoke test — tap leaking',
        description: 'Raised by the automated smoke test to verify the workflow end to end.',
      }),
    })
    const body = await created.json()
    log(created.status === 201, 'complaint created', body.complaint?.code ?? JSON.stringify(body))
    complaintId = body.complaint?.id ?? null
  }

  // Assign it to a worker who has a login, so the worker app can finish it.
  let assignedStaffId = null
  if (complaintId) {
    const staffRes = await owner.fetch(`/api/staff?propertyId=${property.id}`)
    const { staff } = await staffRes.json()
    // The seeded worker login belongs to the cook; any staff member works.
    const member = staff.find((s) => s.name === 'Selvi Anandhi') ?? staff[0]
    assignedStaffId = member?.id ?? null
    log(Boolean(member), 'found a worker to assign', member?.name ?? 'none')

    if (assignedStaffId) {
      const assigned = await owner.fetch('/api/complaints', {
        method: 'PATCH',
        body: JSON.stringify({
          complaintId,
          action: 'ASSIGN',
          staffId: assignedStaffId,
          message: 'Assigned by the smoke test.',
        }),
      })
      const assignBody = await assigned.json()
      log(assigned.status === 200, 'complaint assigned to worker', assignBody.message ?? `HTTP ${assigned.status}`)
    }
  }

  // ------------------------------------------------------------ admin ----
  section('Super Admin')
  const admin = await signIn('admin@stayflow.app')
  await checkPages(admin, 'admin', [
    '/admin',
    '/admin/organizations',
    '/admin/properties',
    '/admin/leads',
    '/admin/subscriptions',
    '/admin/payments',
    '/admin/plans',
    '/admin/features',
    '/admin/support',
    '/admin/audit',
    '/admin/notifications',
    '/admin/settings',
  ])

  const cron = await admin.fetch('/api/cron/run', { method: 'POST' })
  const cronBody = await cron.json().catch(() => ({}))
  log(cron.status === 200, 'automation pass runs', cronBody.message ?? `HTTP ${cron.status}`)

  // ----------------------------------------------------------- tenant ----
  section('Resident app')
  const tenant = await signIn('tenant@stayflow.app')
  await checkPages(tenant, 'tenant', [
    '/tenant',
    '/tenant/rent',
    '/tenant/complaints',
    '/tenant/food',
    '/tenant/announcements',
    '/tenant/documents',
    '/tenant/profile',
    '/tenant/notifications',
  ])

  // A resident must not reach the owner dashboard or its APIs.
  const tenantBlocked = await tenant.fetch('/app')
  log(
    [307, 302, 308].includes(tenantBlocked.status),
    'resident cannot open the owner dashboard',
    `HTTP ${tenantBlocked.status}`,
  )
  const tenantApi = await tenant.fetch('/api/payments', {
    method: 'POST',
    body: JSON.stringify({ residentId: 'x', amount: 100, method: 'CASH' }),
  })
  log(tenantApi.status === 403, 'resident cannot record payments', `HTTP ${tenantApi.status}`)

  // ----------------------------------------------------------- worker ----
  section('Worker app')
  const worker = await signIn('worker@stayflow.app')
  await checkPages(worker, 'worker', [
    '/worker',
    '/worker/tasks',
    '/worker/food',
    '/worker/grocery',
    '/worker/profile',
    '/worker/notifications',
  ])

  // The assigned complaint must now be a task in the worker's own list.
  if (complaintId) {
    const tasksPage = await worker.fetch('/worker/tasks')
    const html = await tasksPage.text()
    const hasTask = html.includes('Smoke test')
    log(hasTask, "assigned complaint appears in the worker's task list")
  }

  const workerBlocked = await worker.fetch('/admin')
  log(
    [307, 302, 308].includes(workerBlocked.status),
    'worker cannot open the platform portal',
    `HTTP ${workerBlocked.status}`,
  )
  const workerApi = await worker.fetch('/api/operations', {
    method: 'POST',
    body: JSON.stringify({
      entity: 'EXPENSE',
      propertyId: property?.id ?? 'x',
      categoryId: 'x',
      title: 'Nope',
      amount: 100,
      spentOn: new Date().toISOString().slice(0, 10),
    }),
  })
  log(workerApi.status === 403, 'worker cannot record expenses', `HTTP ${workerApi.status}`)

  // The worker finishing the task must resolve the complaint for the resident.
  section('Workflow: worker completes the task')
  if (complaintId) {
    const tasksRes = await owner.fetch(`/api/staff?propertyId=${property.id}`)
    await tasksRes.json().catch(() => ({}))

    const resolved = await worker.fetch('/api/complaints', {
      method: 'PATCH',
      body: JSON.stringify({
        complaintId,
        action: 'STATUS',
        status: 'RESOLVED',
        message: 'Replaced the washer. Verified by the smoke test.',
      }),
    })
    const resolveBody = await resolved.json().catch(() => ({}))
    log(resolved.status === 200, 'worker resolves the complaint', resolveBody.message ?? `HTTP ${resolved.status}`)

    // And the owner must see it as resolved.
    const detail = await owner.fetch(`/app/complaints/${complaintId}`)
    const detailHtml = await detail.text()
    log(detailHtml.includes('Replaced the washer'), 'resolution note is visible to the owner')
  }

  // ------------------------------------------------------------ leads ----
  // ------------------------------------------------ cleanup / checkout ----
  // Check the smoke resident out again so repeated runs never run out of beds;
  // this also exercises the settlement path end to end.
  if (newResidentId) {
    section('Workflow: checkout')
    const today = new Date().toISOString().slice(0, 10)
    const preview = await owner.fetch('/api/residents/actions', {
      method: 'POST',
      body: JSON.stringify({ action: 'CHECKOUT_PREVIEW', residentId: newResidentId, exitDate: today }),
    })
    log(preview.status === 200, 'settlement preview', `HTTP ${preview.status}`)
    const out = await owner.fetch('/api/residents/actions', {
      method: 'POST',
      body: JSON.stringify({ action: 'CHECKOUT', residentId: newResidentId, exitDate: today, reason: 'Smoke test', refund: null }),
    })
    log(out.status === 200, 'smoke resident checked out, bed released', `HTTP ${out.status}`)
  }

  section('Website enquiry')
  const lead = await fetch(`${BASE}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke Test Owner',
      phone: '9800000001',
      pgName: 'Smoke PG',
      pgCount: 1,
      pgTypes: 'MENS',
      city: 'Chennai',
      source: 'smoke-test',
    }),
  })
  log(lead.status === 201, 'demo enquiry accepted', `HTTP ${lead.status}`)

  const badLead = await fetch(`${BASE}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'X', phone: '123' }),
  })
  log(badLead.status === 422, 'invalid enquiry is rejected', `HTTP ${badLead.status}`)

  // ---------------------------------------------------------- summary ----
  console.log(`\n${'─'.repeat(52)}`)
  console.log(`\x1b[1m${passed} passed\x1b[0m` + (failed ? `, \x1b[31m${failed} failed\x1b[0m` : ''))
  if (failures.length) {
    console.log('\nFailures:')
    for (const failure of failures) console.log(`  - ${failure}`)
  }
  console.log('')
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error('\nSmoke test crashed:', error)
  process.exit(1)
})
