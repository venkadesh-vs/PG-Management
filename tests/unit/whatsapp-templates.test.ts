import { describe, expect, it } from 'vitest'
import {
  MAX_TEMPLATE_BODY,
  WHATSAPP_TEMPLATES,
  getTemplate,
  prepareVariables,
  renderTemplate,
  sanitizeVariable,
  templateLabel,
  type WhatsAppTemplateDef,
} from '@/server/integrations/whatsapp-templates'

const entries = Object.entries(WHATSAPP_TEMPLATES) as [string, WhatsAppTemplateDef][]

describe('WhatsApp templates', () => {
  it.each(entries)('%s: placeholders are {{1}}..{{n}} in order, n = variables.length', (_name, def) => {
    const found = [...def.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))
    expect(found).toEqual(def.variables.map((_, i) => i + 1))
  })

  it.each(entries)('%s: has a Meta-compatible name and fits the body limit', (name, def) => {
    expect(name).toMatch(/^[a-z0-9_]+$/)
    expect(def.body.length).toBeLessThanOrEqual(MAX_TEMPLATE_BODY)
    expect(def.label.length).toBeGreaterThan(0)
    expect(def.language).toBeTruthy()
  })

  it('only account-access templates bypass a STOP opt-out', () => {
    const bypass = entries.filter(([, d]) => d.bypassOptOut).map(([n]) => n).sort()
    expect(bypass).toEqual(['account_invite', 'password_reset'])
  })

  it('getTemplate ignores prototype keys', () => {
    expect(getTemplate('payment_receipt')).not.toBeNull()
    expect(getTemplate('toString')).toBeNull()
    expect(getTemplate('__proto__')).toBeNull()
    expect(templateLabel('nope')).toBe('nope')
    expect(templateLabel(null)).toBe('Message')
  })
})

describe('sanitizeVariable', () => {
  it('flattens line breaks and whitespace that Meta rejects', () => {
    expect(sanitizeVariable('Water off\nfrom 10am\r\n\r\nto 2pm')).toBe('Water off · from 10am · to 2pm')
    expect(sanitizeVariable('a\tb     c')).toBe('a b c')
    expect(sanitizeVariable('  padded  ')).toBe('padded')
  })

  it('never returns an empty parameter', () => {
    expect(sanitizeVariable('')).toBe('-')
    expect(sanitizeVariable('   \n  ')).toBe('-')
    expect(sanitizeVariable(null)).toBe('-')
    expect(sanitizeVariable(undefined)).toBe('-')
  })

  it('stringifies numbers and caps length', () => {
    expect(sanitizeVariable(4500)).toBe('4500')
    expect(sanitizeVariable('x'.repeat(5000)).length).toBeLessThanOrEqual(MAX_TEMPLATE_BODY)
  })

  it('output never contains newlines, tabs or 5+ spaces', () => {
    const out = sanitizeVariable('a\n\n\tb\v\fc          d\r\ne')
    expect(out).not.toMatch(/[\n\r\t]| {5,}/)
  })
})

describe('renderTemplate / prepareVariables', () => {
  const def = WHATSAPP_TEMPLATES.announcement

  it('renders every placeholder', () => {
    const text = renderTemplate(def, ['Asha', 'Water', 'Off at 10'])
    expect(text).not.toMatch(/\{\{\d+\}\}/)
    expect(text).toContain('Hi Asha')
  })

  it('shrinks the longest variable until the body fits', () => {
    const vars = prepareVariables(def, ['Asha', 'Title', 'y'.repeat(3000)])
    expect(renderTemplate(def, vars).length).toBeLessThanOrEqual(MAX_TEMPLATE_BODY)
    expect(vars[0]).toBe('Asha')
    expect(vars[2].endsWith('…')).toBe(true)
  })
})
