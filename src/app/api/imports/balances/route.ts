import { importRoutes } from '../handler'

/** Opening balances import (payments.record + residents.manage) — see ../handler.ts. */
export const maxDuration = 300

const handlers = importRoutes('balances')
export const GET = handlers.GET
export const POST = handlers.POST
