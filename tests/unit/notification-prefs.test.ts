import { describe, expect, it } from 'vitest'
import {
  applyPrefChanges,
  DEFAULT_PREFS,
  isChannelOn,
  NOTIFICATION_TYPE_KEYS,
  NOTIFICATION_TYPES,
  parseNotificationPrefs,
  prefsGrid,
  sampleValue,
  TEMPLATE_TYPE,
  typeForKind,
  typeForTemplate,
} from '@/lib/notification-prefs'
import { WHATSAPP_TEMPLATES } from '@/server/integrations/whatsapp-templates'
import { centreFilters } from '@/lib/message-centre'

describe('parseNotificationPrefs', () => {
  it('treats missing or malformed settings as everything on', () => {
    for (const raw of [null, undefined, 'x', 42, [], { types: 'nope' }, { types: [] }]) {
      const prefs = parseNotificationPrefs(raw)
      expect(prefs.types).toEqual({})
      for (const type of NOTIFICATION_TYPE_KEYS) {
        for (const channel of NOTIFICATION_TYPES[type].channels) expect(isChannelOn(prefs, type, channel)).toBe(true)
      }
    }
  })

  it('drops unknown types, unknown channels and non-boolean values', () => {
    const prefs = parseNotificationPrefs({
      types: {
        RENT_REMINDER: { WHATSAPP: false, IN_APP: 'no', FAX: false },
        MADE_UP: { WHATSAPP: false },
        PAYMENT_RECEIPT: null,
      },
    })
    expect(prefs.types).toEqual({ RENT_REMINDER: { WHATSAPP: false } })
    expect(isChannelOn(prefs, 'RENT_REMINDER', 'WHATSAPP')).toBe(false)
    expect(isChannelOn(prefs, 'RENT_REMINDER', 'IN_APP')).toBe(true)
  })

  it('never lets a stored value switch off login links', () => {
    const prefs = parseNotificationPrefs({ types: { ACCOUNT_ACCESS: { WHATSAPP: false, EMAIL: false } } })
    expect(isChannelOn(prefs, 'ACCOUNT_ACCESS', 'WHATSAPP')).toBe(true)
    expect(isChannelOn(prefs, 'ACCOUNT_ACCESS', 'EMAIL')).toBe(true)
  })
})

describe('applyPrefChanges', () => {
  it('stores only what is off and removes entries switched back on', () => {
    let prefs = applyPrefChanges(DEFAULT_PREFS, [
      { type: 'RENT_REMINDER', channel: 'WHATSAPP', enabled: false },
      { type: 'ANNOUNCEMENT', channel: 'IN_APP', enabled: false },
    ])
    expect(prefs.types).toEqual({ RENT_REMINDER: { WHATSAPP: false }, ANNOUNCEMENT: { IN_APP: false } })
    prefs = applyPrefChanges(prefs, [{ type: 'RENT_REMINDER', channel: 'WHATSAPP', enabled: true }])
    expect(prefs.types).toEqual({ ANNOUNCEMENT: { IN_APP: false } })
  })

  it('ignores locked types, unknown types and channels a type is not sent on', () => {
    const prefs = applyPrefChanges(DEFAULT_PREFS, [
      { type: 'ACCOUNT_ACCESS', channel: 'WHATSAPP', enabled: false },
      { type: 'NOPE', channel: 'WHATSAPP', enabled: false },
      { type: 'RENT_INVOICE', channel: 'WHATSAPP', enabled: false },
      { type: 'CHECKOUT', channel: 'IN_APP', enabled: false },
    ])
    expect(prefs.types).toEqual({})
  })

  it('does not mutate its input', () => {
    const start = applyPrefChanges(DEFAULT_PREFS, [{ type: 'VISITOR', channel: 'IN_APP', enabled: false }])
    const copy = JSON.parse(JSON.stringify(start))
    applyPrefChanges(start, [{ type: 'VISITOR', channel: 'IN_APP', enabled: true }])
    expect(start).toEqual(copy)
    expect(DEFAULT_PREFS.types).toEqual({})
  })
})

describe('prefsGrid', () => {
  it('lists exactly the channels each type is sent on', () => {
    const grid = prefsGrid(parseNotificationPrefs({ types: { CHECKOUT: { WHATSAPP: false } } }))
    expect(grid.CHECKOUT).toEqual({ WHATSAPP: false })
    expect(grid.RENT_INVOICE).toEqual({ IN_APP: true })
    expect(grid.PAYMENT_RECEIPT).toEqual({ IN_APP: true, WHATSAPP: true })
  })
})

describe('type mapping', () => {
  it('maps every WhatsApp template to a switch that covers WhatsApp', () => {
    for (const name of Object.keys(WHATSAPP_TEMPLATES)) {
      const type = typeForTemplate(name)
      expect(type, name).not.toBeNull()
      expect((NOTIFICATION_TYPES[type!].channels as string[]).includes('WHATSAPP'), name).toBe(true)
    }
    expect(Object.keys(TEMPLATE_TYPE).sort()).toEqual(Object.keys(WHATSAPP_TEMPLATES).sort())
    expect(typeForTemplate('unknown')).toBeNull()
    expect(typeForTemplate(null)).toBeNull()
  })

  it('maps resident in-app kinds to switches that cover in-app', () => {
    for (const kind of ['RENT', 'PAYMENT', 'COMPLAINT', 'MAINTENANCE', 'ANNOUNCEMENT', 'SYSTEM']) {
      const type = typeForKind(kind)
      expect(type, kind).not.toBeNull()
      expect((NOTIFICATION_TYPES[type!].channels as string[]).includes('IN_APP'), kind).toBe(true)
    }
    expect(typeForKind('SUBSCRIPTION')).toBeNull()
  })

  it('has a sample for every template variable', () => {
    for (const def of Object.values(WHATSAPP_TEMPLATES)) {
      for (const variable of def.variables) expect(sampleValue(variable), variable).not.toBe(variable)
    }
  })
})

describe('centreFilters', () => {
  it('keeps known values and ignores the rest', () => {
    const f = centreFilters({ channel: 'WHATSAPP', status: 'RETRIED', q: '  priya ', page: '3', group: 'rent' })
    expect(f).toMatchObject({ channel: 'WHATSAPP', status: 'RETRIED', q: 'priya', page: 3, group: 'rent' })
    const bad = centreFilters({ channel: 'FAX', status: 'LOST', page: '-2', from: '2026-13-40', to: 'yesterday' })
    expect(bad).toMatchObject({ channel: null, status: null, page: 1, from: null, to: null })
  })

  it('makes the to-date inclusive (midnight after it)', () => {
    const f = centreFilters({ from: '2026-10-01', to: '2026-10-07' })
    expect(f.from).toEqual(new Date(2026, 9, 1))
    expect(f.to).toEqual(new Date(2026, 9, 8))
    expect(centreFilters({ to: '2026-12-31' }).to).toEqual(new Date(2027, 0, 1))
  })

  it('rejects impossible calendar dates', () => {
    expect(centreFilters({ from: '2026-02-30' }).from).toBeNull()
  })
})
