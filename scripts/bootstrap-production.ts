/**
 * Prepares an empty production database: `npm run bootstrap:prod`.
 *
 * Safe to run more than once and never deletes anything:
 *   - creates the subscription plans, feature flags and platform settings that
 *     are missing (existing ones, including prices edited in Super Admin, are
 *     left exactly as they are);
 *   - creates the first Super Admin if no account with that email exists.
 *
 * The Super Admin gets no password. A single-use "set your password" link
 * (valid 72 hours) is written to BOOTSTRAP_LINK_FILE and never printed, so it
 * does not end up in terminal logs. Open the file, use the link, delete the file.
 *
 * Required env: DATABASE_URL, NEXT_PUBLIC_SITE_URL (the production URL),
 *               BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_LINK_FILE
 */
import { writeFileSync } from 'node:fs'
import { PLATFORM_FEATURE_FLAGS, PLATFORM_PLANS, PLATFORM_SETTINGS } from '../prisma/platform-data'
import { prisma } from '../src/lib/prisma'
import { issueAuthToken } from '../src/server/auth-tokens'
import { normaliseEmail, unusablePasswordHash } from '../src/server/services/accounts'

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Set ${name} before running the bootstrap.`)
  return value
}

async function main() {
  const email = normaliseEmail(required('BOOTSTRAP_ADMIN_EMAIL'))
  const name = required('BOOTSTRAP_ADMIN_NAME')
  const linkFile = required('BOOTSTRAP_LINK_FILE')
  const siteUrl = required('NEXT_PUBLIC_SITE_URL')
  if (process.env.NODE_ENV === 'production' && !siteUrl.startsWith('https://')) {
    throw new Error('NEXT_PUBLIC_SITE_URL must be the https:// production address.')
  }

  console.log('\nStayFlow production bootstrap\n' + '─'.repeat(40))

  let plansCreated = 0
  for (const data of PLATFORM_PLANS) {
    const exists = await prisma.plan.findUnique({ where: { slug: data.slug }, select: { id: true } })
    if (!exists) {
      await prisma.plan.create({ data })
      plansCreated++
    }
  }
  const flags = await prisma.featureFlag.createMany({ data: PLATFORM_FEATURE_FLAGS, skipDuplicates: true })
  const settings = await prisma.systemSetting.createMany({ data: PLATFORM_SETTINGS, skipDuplicates: true })
  console.log(`  plans created        ${plansCreated} (of ${PLATFORM_PLANS.length})`)
  console.log(`  feature flags added  ${flags.count}`)
  console.log(`  settings added       ${settings.count}`)

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } })
  if (existing) {
    console.log(`  super admin          already exists (${existing.role}); no link issued`)
  } else {
    const admin = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await unusablePasswordHash(),
        mustChangePassword: true,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
    })
    const { url } = await issueAuthToken(admin.id, 'INVITE')
    writeFileSync(linkFile, `StayFlow Super Admin (${email}) - set your password, valid 72 hours, single use:\n${url}\n`, {
      mode: 0o600,
    })
    console.log(`  super admin          created; set-password link written to the link file`)
  }
  console.log('─'.repeat(40))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
