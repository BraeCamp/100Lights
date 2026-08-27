/**
 * The browser-side API client.
 *
 * There was no such thing: 245 fetch() call sites each re-implemented headers,
 * JSON encoding, res.ok handling and error extraction, 136 of them repeating
 * `'Content-Type': 'application/json'` by hand. They had drifted into at least
 * four different error styles, including two that did `throw new Error()` with
 * no message — which surfaces to the user as an empty toast.
 *
 *   const data = await apiGet<{ codes: Code[] }>('/api/admin/codes')
 *   await apiPost('/api/admin/codes', { kind, grantDays })
 *   await apiDelete(`/api/admin/codes/${id}`)
 *
 * Every helper throws ApiError on a non-2xx, carrying the status and the
 * server's `error` field when it sent one. Callers that want the old
 * swallow-and-continue behaviour should catch explicitly, so the decision to
 * ignore a failure is visible in the code rather than implied by its absence.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (cause) {
    // Offline, DNS failure, request aborted — never reached the server.
    throw new ApiError(cause instanceof Error ? cause.message : 'Network request failed', 0, cause)
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = text }
  }

  if (!res.ok) {
    const fromServer =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : null
    throw new ApiError(fromServer || `HTTP ${res.status}`, res.status, body)
  }

  return body as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function apiGet<T>(url: string, init?: RequestInit): Promise<T> {
  return request<T>(url, init)
}

export function apiPost<T = unknown>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, body === undefined ? { method: 'POST' } : json('POST', body))
}

export function apiPatch<T = unknown>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, body === undefined ? { method: 'PATCH' } : json('PATCH', body))
}

export function apiPut<T = unknown>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, body === undefined ? { method: 'PUT' } : json('PUT', body))
}

export function apiDelete<T = unknown>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, body === undefined ? { method: 'DELETE' } : json('DELETE', body))
}

/** Message for a toast/inline error, from anything a catch block can receive. */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error && e.message) return e.message
  return fallback
}
