import { importRoutes } from '../handler'

/** Rooms & beds import (properties.manage + residents.manage) — see ../handler.ts. */
export const maxDuration = 300

const handlers = importRoutes('rooms')
export const GET = handlers.GET
export const POST = handlers.POST
