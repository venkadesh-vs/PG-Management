'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Input } from './input'

/**
 * Indian-format inputs. Each one cleans what is typed or pasted before the
 * form sees it, so the value is always in the stored shape:
 *   PhoneInput    fixed +91, exactly 10 digits ("9876543210")
 *   PincodeInput  6 digits
 *   AadhaarInput  12 digits
 *   PanInput      ABCDE1234F (upper case)
 *   GstinInput    15 characters (upper case)
 *   IfscInput     ABCD0123456 (upper case)
 *   AccountNumberInput 9–18 digits
 *   UpiIdInput    name@bank (lower case, no spaces)
 *   DigitsInput   any whole number (amounts, counts)
 *
 * They work with react-hook-form's register() and with value/onChange alike:
 * the cleaned text is written back to the input before onChange fires.
 */

type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/** Wraps onChange so the input's text is cleaned first. */
function useCleaned(clean: (raw: string) => string, onChange: InputProps['onChange']) {
  return React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const cleaned = clean(e.target.value)
      if (cleaned !== e.target.value) e.target.value = cleaned
      onChange?.(e)
    },
    [clean, onChange],
  )
}

/**
 * A forwarded ref plus our own, so a value already in the form (an older
 * "+91 98765 43210", a lower-case PAN) is shown cleaned as soon as it mounts.
 */
function useCleanOnMount(ref: React.ForwardedRef<HTMLInputElement>, clean: (raw: string) => string) {
  const inner = React.useRef<HTMLInputElement>(null)
  React.useImperativeHandle(ref, () => inner.current as HTMLInputElement, [])
  React.useEffect(() => {
    const el = inner.current
    if (el && el.value && clean(el.value) !== el.value) el.value = clean(el.value)
  }, [clean])
  return inner
}

const cleanValue = (value: InputProps['value'], clean: (raw: string) => string) =>
  value === undefined || value === null ? value : clean(String(value))

/** 10-digit Indian mobile: drops spaces, dashes, a leading +91 / 91 / 0. */
export function cleanPhone(raw: string) {
  let d = raw.replace(/\D/g, '')
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2)
  if (d.length > 10 && d.startsWith('0')) d = d.slice(1)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return d.slice(0, 10)
}

export const cleanDigits = (max: number) => (raw: string) => raw.replace(/\D/g, '').slice(0, max)
export const cleanUpperAlnum = (max: number) => (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max)
export const cleanUpi = (raw: string) => raw.toLowerCase().replace(/\s/g, '').replace(/[^a-z0-9.\-_@]/g, '').slice(0, 60)

export const PhoneInput = React.forwardRef<HTMLInputElement, InputProps>(({ className, onChange, value, ...props }, ref) => {
  const handle = useCleaned(cleanPhone, onChange)
  const setRef = useCleanOnMount(ref, cleanPhone)
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center gap-1.5 border-r border-slate-200 pl-3 pr-2.5 text-sm font-medium text-slate-600">
        <span aria-hidden>🇮🇳</span>+91
      </span>
      <Input
        ref={setRef}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        pattern="[6-9][0-9]{9}"
        maxLength={10}
        placeholder="98765 43210"
        title="10-digit mobile number"
        {...props}
        value={cleanValue(value, cleanPhone)}
        onChange={handle}
        className="pl-[4.75rem] tabular-nums tracking-wide"
      />
    </div>
  )
})
PhoneInput.displayName = 'PhoneInput'

function makeInput(
  name: string,
  clean: (raw: string) => string,
  defaults: InputProps,
) {
  const C = React.forwardRef<HTMLInputElement, InputProps>(({ onChange, value, className, ...props }, ref) => {
    const handle = useCleaned(clean, onChange)
    const setRef = useCleanOnMount(ref, clean)
    return <Input ref={setRef} {...defaults} {...props} value={cleanValue(value, clean)} onChange={handle} className={cn(defaults.className, className)} />
  })
  C.displayName = name
  return C
}

export const PincodeInput = makeInput('PincodeInput', cleanDigits(6), {
  inputMode: 'numeric',
  autoComplete: 'postal-code',
  pattern: '[1-9][0-9]{5}',
  maxLength: 6,
  placeholder: '600097',
  title: '6-digit PIN code',
  className: 'tabular-nums tracking-wide',
})

export const AadhaarInput = makeInput('AadhaarInput', cleanDigits(12), {
  inputMode: 'numeric',
  pattern: '[2-9][0-9]{11}',
  maxLength: 12,
  placeholder: '12-digit Aadhaar number',
  title: '12-digit Aadhaar number',
  className: 'tabular-nums tracking-wide',
})

export const PanInput = makeInput('PanInput', cleanUpperAlnum(10), {
  autoCapitalize: 'characters',
  pattern: '[A-Z]{5}[0-9]{4}[A-Z]',
  maxLength: 10,
  placeholder: 'ABCDE1234F',
  title: 'PAN: 5 letters, 4 digits, 1 letter',
  className: 'uppercase tracking-wide',
})

export const GstinInput = makeInput('GstinInput', cleanUpperAlnum(15), {
  autoCapitalize: 'characters',
  pattern: '[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]',
  maxLength: 15,
  placeholder: '33ABCDE1234F1Z5',
  title: '15-character GSTIN',
  className: 'uppercase tracking-wide',
})

export const IfscInput = makeInput('IfscInput', cleanUpperAlnum(11), {
  autoCapitalize: 'characters',
  pattern: '[A-Z]{4}0[A-Z0-9]{6}',
  maxLength: 11,
  placeholder: 'SBIN0001234',
  title: 'IFSC: 4 letters, 0, then 6 letters or digits',
  className: 'uppercase tracking-wide',
})

export const AccountNumberInput = makeInput('AccountNumberInput', cleanDigits(18), {
  inputMode: 'numeric',
  pattern: '[0-9]{9,18}',
  maxLength: 18,
  placeholder: 'Bank account number',
  title: '9 to 18 digits',
  className: 'tabular-nums tracking-wide',
})

export const UpiIdInput = makeInput('UpiIdInput', cleanUpi, {
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
  pattern: '[a-z0-9.\\-_]{2,}@[a-z]{2,}',
  placeholder: 'name@okaxis',
  title: 'UPI ID, like name@okaxis',
})

/** Whole numbers only (rupee amounts, counts). `maxDigits` defaults to 8 (₹9.9 crore). */
export const DigitsInput = React.forwardRef<HTMLInputElement, InputProps & { maxDigits?: number }>(
  ({ maxDigits = 8, onChange, value, ...props }, ref) => {
    const clean = React.useMemo(() => cleanDigits(maxDigits), [maxDigits])
    const handle = useCleaned(clean, onChange)
    const setRef = useCleanOnMount(ref, clean)
    return <Input ref={setRef} inputMode="numeric" {...props} value={cleanValue(value, clean)} onChange={handle} />
  },
)
DigitsInput.displayName = 'DigitsInput'
