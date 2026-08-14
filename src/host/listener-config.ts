import { isIP } from 'node:net'
import { ApiError } from './errors.ts'

export const DEFAULT_REMOTE_HOST = '0.0.0.0'

export function normalizeListenerHost(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || isIP(value.trim()) === 0) {
    throw new ApiError(400, 'LISTENER_HOST_INVALID', 'host must be a numeric IPv4 or IPv6 address.')
  }
  return value.trim()
}

export function normalizeListenerPort(value: unknown, allowZero = false): number {
  if (!Number.isInteger(value) || (value as number) < (allowZero ? 0 : 1) || (value as number) > 65535) {
    throw new ApiError(400, 'LISTENER_PORT_INVALID', `port must be between ${allowZero ? 0 : 1} and 65535.`)
  }
  return value as number
}

export function loopbackFor(host: string): '127.0.0.1' | '::1' {
  return isIP(host) === 6 ? '::1' : '127.0.0.1'
}
