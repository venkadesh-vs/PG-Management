import { destroySession } from '@/lib/auth'
import { handleError, ok } from '@/lib/api-helpers'

export async function POST() {
  try {
    await destroySession()
    return ok({ success: true })
  } catch (error) {
    return handleError(error)
  }
}
