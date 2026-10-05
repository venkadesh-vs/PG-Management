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
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })

  const text = await res.text()
  const payload = text ? safeParse(text) : null

  if (!res.ok) {
    const message =
      (payload as { error?: string } | null)?.error ??
      (res.status === 403
        ? 'You do not have permission to do that'
        : res.status === 404
          ? 'Not found'
          : 'Something went wrong')
    throw new ApiError(message, res.status, (payload as { details?: unknown } | null)?.details)
  }

  return payload as T
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
