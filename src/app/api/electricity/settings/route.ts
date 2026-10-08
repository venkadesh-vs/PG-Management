import { route } from '@/lib/api-helpers'
import { getElectricitySettings, readBody, settingsSchema, updateElectricitySettings } from '@/server/services/electricity'

/**
 * How room bills are shared and billed.
 *   GET   → { settings: { splitMethod, billingMode, excludeLeaveDays } }
 *   PATCH { electricitySplitMethod?, electricityBillingMode?, electricityExcludeLeaveDays? } → { settings, message }
 */
export const GET = route(async ({ user }) => ({ settings: await getElectricitySettings(user) }), {
  module: 'electricity',
  permission: 'electricity.view',
})

export const PATCH = route(
  async ({ user, request }) => {
    const body = await readBody(request, settingsSchema)
    await updateElectricitySettings(user, body)
    return { settings: await getElectricitySettings(user), message: 'Electricity settings saved' }
  },
  { module: 'electricity', permission: 'settings.manage' },
)
