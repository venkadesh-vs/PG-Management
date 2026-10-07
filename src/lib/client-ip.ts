/**
 * The client IP from request headers, or null when it cannot be trusted.
 *
 * Netlify always sets x-nf-client-connection-ip and a client cannot forge it.
 * x-real-ip / x-forwarded-for are only believed when TRUST_PROXY_HEADERS=true,
 * i.e. when the app sits behind a proxy you run that overwrites them —
 * otherwise anyone could send a new value per request and dodge rate limits.
 */
export function ipFromHeaders(
  get: (name: string) => string | null,
  trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === 'true',
): string | null {
  const platform = get('x-nf-client-connection-ip')?.trim()
  if (platform) return platform
  if (!trustProxyHeaders) return null
  const real = get('x-real-ip')?.trim()
  if (real) return real
  // The right-most entry is the one our own proxy appended.
  const forwarded = (get('x-forwarded-for') ?? '').split(',').pop()?.trim()
  return forwarded || null
}
