import { describe, expect, it } from 'vitest'
import { idNumberProblem, idNumberRule, INDIA } from '@/lib/india'
import { cleanDigits, cleanPhone, cleanUpi, cleanUpperAlnum } from '@/components/ui/india-inputs'

describe('cleanPhone', () => {
  it('keeps 10 digits and drops +91, 91, 0, spaces and dashes', () => {
    expect(cleanPhone('9876543210')).toBe('9876543210')
    expect(cleanPhone('+91 98765 43210')).toBe('9876543210')
    expect(cleanPhone('919876543210')).toBe('9876543210')
    expect(cleanPhone('09876543210')).toBe('9876543210')
    expect(cleanPhone('98765-43210')).toBe('9876543210')
  })

  it('never lets more than 10 digits or letters through', () => {
    expect(cleanPhone('98765432109999')).toBe('9876543210')
    expect(cleanPhone('98ab76')).toBe('9876')
  })
})

describe('other cleaners', () => {
  it('pincode and Aadhaar take digits only, up to their length', () => {
    expect(cleanDigits(6)('600 097x1')).toBe('600097')
    expect(cleanDigits(12)('2345 6789 0123 99')).toBe('234567890123')
  })
  it('PAN, IFSC and GSTIN are upper case letters and digits', () => {
    expect(cleanUpperAlnum(10)('abcde 1234f')).toBe('ABCDE1234F')
    expect(cleanUpperAlnum(11)('sbin-0001234')).toBe('SBIN0001234')
  })
  it('UPI IDs are lower case without spaces', () => {
    expect(cleanUpi('Ravi Kumar@OKAXIS')).toBe('ravikumar@okaxis')
  })
})

describe('INDIA rules', () => {
  it('mobile numbers start 6–9 and have 10 digits', () => {
    expect(INDIA.mobile.test('9876543210')).toBe(true)
    expect(INDIA.mobile.test('5876543210')).toBe(false)
    expect(INDIA.mobile.test('987654321')).toBe(false)
  })
  it('pincode cannot start with 0', () => {
    expect(INDIA.pincode.test('600097')).toBe(true)
    expect(INDIA.pincode.test('060097')).toBe(false)
  })
  it('GSTIN, IFSC and UPI', () => {
    expect(INDIA.gstin.test('33ABCDE1234F1Z5')).toBe(true)
    expect(INDIA.ifsc.test('HDFC0001234')).toBe(true)
    expect(INDIA.ifsc.test('HDFC1001234')).toBe(false)
    expect(INDIA.upi.test('stayflow@okhdfcbank')).toBe(true)
    expect(INDIA.upi.test('stayflow')).toBe(false)
  })
})

describe('ID numbers by type', () => {
  it('checks Aadhaar and PAN, ignores empty and unknown types', () => {
    expect(idNumberProblem('AADHAAR', '2345 6789 0123')).toBeNull()
    expect(idNumberProblem('AADHAAR', '1234')).toMatch(/12 digits/)
    expect(idNumberProblem('PAN', 'abcde1234f')).toBeNull()
    expect(idNumberProblem('PAN', 'ABCD1234F')).toMatch(/PAN/)
    expect(idNumberProblem('AADHAAR', '')).toBeNull()
    expect(idNumberProblem('DRIVING_LICENCE', 'anything')).toBeNull()
  })
  it('knows the cleaner for each type', () => {
    expect(idNumberRule('Aadhaar')?.clean('2345-6789-0123')).toBe('234567890123')
    expect(idNumberRule('PASSPORT')?.clean('k 1234567')).toBe('K1234567')
  })
})
