/**
 * Typed API error class used by all service modules.
 * Thrown whenever an Axios request fails with a structured backend error response.
 */
export class ApiError extends Error {
  status: number
  code: string | undefined
  detail: string

  constructor(status: number, detail: string, code?: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.code = code
  }
}
