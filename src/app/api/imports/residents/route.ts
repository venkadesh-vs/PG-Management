import { importRoutes } from '../handler'

/** Resident import (residents.manage) — see ../handler.ts. */
export const maxDuration = 300

const handlers = importRoutes('residents')
export const GET = handlers.GET
export const POST = handlers.POST
