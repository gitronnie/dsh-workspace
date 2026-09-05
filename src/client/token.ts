import { useSyncExternalStore } from 'react'

const TOKEN_KEY = 'dsh-workspace-device-token'

let token = readToken()
const listeners = new Set<() => void>()

function readToken(): string {
  try {
    return globalThis.localStorage?.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function persist(value: string): void {
  try {
    if (value === '') globalThis.localStorage?.removeItem(TOKEN_KEY)
    else globalThis.localStorage?.setItem(TOKEN_KEY, value)
  } catch {
    // Storage can be unavailable in embedded WebViews.
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function getToken(): string {
  return token
}

export function setToken(value: string): void {
  token = value
  persist(value)
  emit()
}

export function clearToken(): void {
  setToken('')
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useWorkspaceToken(): string {
  return useSyncExternalStore(subscribe, getToken)
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().split('%')[0]
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]'
}
