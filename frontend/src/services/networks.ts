import { isAxiosError } from 'axios'
import { apiClient } from '../lib/api'
import type { Network } from '../stores/merchantStore'
import { ApiError } from './errors'

export { ApiError }
export type { Network }

// ─── In-memory session cache ──────────────────────────────────────────────────

/**
 * Module-level cache populated on the first successful fetch.
 * Persists for the lifetime of the browser session (cleared on page reload).
 */
let _networksCache: Network[] | null = null

// ─── Error helper ─────────────────────────────────────────────────────────────

function handleAxiosError(err: unknown): never {
  if (isAxiosError(err) && err.response) {
    const { status, data } = err.response
    const detail: string =
      typeof data?.detail === 'string' ? data.detail : 'An error occurred'
    const code: string | undefined =
      typeof data?.code === 'string' ? data.code : undefined
    throw new ApiError(status, detail, code)
  }
  throw err
}

// ─── Networks service function ────────────────────────────────────────────────

/**
 * Fetch the list of supported EVM networks and their tokens.
 * GET /networks
 *
 * The result is cached in memory after the first successful call; subsequent
 * calls within the same browser session return the cached value immediately
 * without making a network request.
 */
export async function getNetworks(): Promise<Network[]> {
  if (_networksCache !== null) {
    return _networksCache
  }

  try {
    const { data } = await apiClient.get<Network[]>('/networks')
    _networksCache = data
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}
