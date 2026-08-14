export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  return new ApiError(500, 'INTERNAL_ERROR', 'An internal server error occurred.')
}
