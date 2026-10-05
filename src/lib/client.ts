'use client'

/**
 * Thin fetch wrapper for the app's own route handlers. Keeps error shape
 * consistent so every caller can surface a real message in a toast instead of
 * a generic failure.
 */

export class ApiError extends Error {
  status: number
  details?: unknown
  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    // fetch only throws when the request never reached the server.
    throw new ApiError(
      typeof navigator !== 'undefined' && !navigator.onLine
        ? 'You are offline. Check your internet connection and try again.'
        : 'We could not reach StayFlow. Check your connection and try again.',
      0,
    )
  }

  const text = await res.text()
  const payload = text ? safeParse(text) : null

  if (!res.ok) {
    const message = (payload as { error?: string } | null)?.error ?? FALLBACK[res.status] ?? FALLBACK[500]
    throw new ApiError(message, res.status, (payload as { details?: unknown } | null)?.details)
  }

  return payload as T
}

const FALLBACK: Record<number, string> = {
  401: 'Your session has ended. Please sign in again.',
  402: 'Your subscription is paused. Pay the pending invoice to continue.',
  403: 'You do not have access to do that.',
  404: 'We could not find that. It may have been removed.',
  409: 'That clashes with something that already exists.',
  413: 'That file is too large.',
  429: 'Too many attempts. Please wait a minute and try again.',
  500: 'Something went wrong on our side. Please try again in a moment.',
}

/**
 * A toast-ready title and description for any error, in plain language.
 * `action` names what the person was doing: "save the expense".
 */
export function friendlyError(error: unknown, action?: string): { title: string; description: string } {
  const doing = action ? `Couldn't ${action}` : 'That did not work'
  if (error instanceof ApiError) {
    if (error.status === 0) return { title: 'No connection', description: error.message }
    if (error.status === 401) return { title: 'Please sign in again', description: error.message }
    if (error.status === 402) return { title: 'Subscription paused', description: error.message }
    if (error.status === 403) return { title: 'Not allowed', description: error.message }
    if (error.status === 429) return { title: 'Slow down a little', description: error.message }
    if (error.status >= 500) return { title: doing, description: error.message }
    return { title: doing, description: error.message }
  }
  return { title: doing, description: FALLBACK[500] }
}

function safeParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const api = {
  get: <T,>(url: string) => request<T>('GET', url),
  post: <T,>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T,>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  put: <T,>(url: string, body?: unknown) => request<T>('PUT', url, body),
  delete: <T,>(url: string, body?: unknown) => request<T>('DELETE', url, body),
}

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const str = search.toString()
  return str ? `?${str}` : ''
}
