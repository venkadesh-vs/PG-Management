import { route } from '@/lib/api-helpers'
import { ValidationError } from '@/lib/tenancy'
import { IMPORT_FIELDS, IMPORT_KINDS, suggestMapping, type ImportKind } from '@/server/services/import-fields'
import { lastMapping } from '@/server/services/import-jobs'
import { assertCanImport } from '@/server/services/import-runner'
import { readUpload } from '@/server/services/import-sheet'

/**
 * POST /api/imports/parse (multipart: file, kind, sheet?)
 * Reads an .xlsx or .csv on the server and returns its header, rows (as
 * text), the sheet list, the StayFlow fields for the kind and a suggested
 * column mapping (the last mapping used for this kind wins). Nothing is saved.
 */
export const maxDuration = 60

export const POST = route(async ({ user, request }) => {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new ValidationError('Choose an Excel or CSV file to upload.')
  }
  const kind = String(form.get('kind') ?? '') as ImportKind
  if (!IMPORT_KINDS.includes(kind)) throw new ValidationError('Choose what you are importing.')
  assertCanImport(user, kind)
  const file = form.get('file')
  if (!(file instanceof File)) throw new ValidationError('Choose an Excel or CSV file to upload.')
  const sheetName = form.get('sheet')
  const sheet = await readUpload(file, typeof sheetName === 'string' && sheetName ? sheetName : null)
  const remembered = await lastMapping(user.organizationId!, kind)
  return {
    ...sheet,
    fields: IMPORT_FIELDS[kind],
    suggested: suggestMapping(kind, sheet.headers, remembered),
  }
})
