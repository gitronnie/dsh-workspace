import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { AuthService } from '../src/host/auth.ts'
import { ApiError, asApiError } from '../src/host/errors.ts'

describe('API security boundaries', () => {
  it('does not trust a null browser origin for loopback administration', () => {
    const auth = new AuthService({} as never)
    const request = {
      headers: { origin: 'null' },
      socket: { remoteAddress: '127.0.0.1' },
    } as IncomingMessage
    expect(() => auth.requireAdmin(request)).toThrowError(ApiError)
  })

  it('does not expose unexpected host errors through the public envelope', () => {
    const error = asApiError(new Error('EACCES: C:\\Users\\private\\secret.txt'))
    expect(error.code).toBe('INTERNAL_ERROR')
    expect(error.message).toBe('An internal server error occurred.')
    expect(error.message).not.toContain('secret.txt')
  })
})
