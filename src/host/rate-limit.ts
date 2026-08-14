import { ApiError } from './errors.ts'

interface Bucket {
  count: number
  resetAt: number
}

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  consume(key: string): void {
    const now = Date.now()
    const current = this.buckets.get(key)
    if (current === undefined || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs })
      this.sweep(now)
      return
    }
    current.count += 1
    if (current.count > this.limit) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again later.', { retryAfterMs: current.resetAt - now })
    }
  }

  private sweep(now: number): void {
    if (this.buckets.size < 2048) return
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key)
  }
}
