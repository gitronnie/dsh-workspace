import { describe, expect, it } from 'vitest'
import { loopbackFor, normalizeListenerHost, normalizeListenerPort } from '../src/host/listener-config.ts'

describe('listener configuration', () => {
  it('accepts IPv4 and IPv6 bind addresses and chooses matching loopback', () => {
    expect(normalizeListenerHost(' 0.0.0.0 ')).toBe('0.0.0.0')
    expect(normalizeListenerHost('192.168.10.20')).toBe('192.168.10.20')
    expect(normalizeListenerHost('::')).toBe('::')
    expect(normalizeListenerHost('2001:db8::10')).toBe('2001:db8::10')
    expect(loopbackFor('0.0.0.0')).toBe('127.0.0.1')
    expect(loopbackFor('::')).toBe('::1')
  })

  it('rejects hostnames and ports outside the public listener range', () => {
    expect(() => normalizeListenerHost('workspace.example.com')).toThrowError(/numeric IPv4 or IPv6/)
    expect(() => normalizeListenerPort(0)).toThrowError(/between 1 and 65535/)
    expect(() => normalizeListenerPort(65_536)).toThrowError(/between 1 and 65535/)
    expect(normalizeListenerPort(30_90)).toBe(30_90)
  })
})
