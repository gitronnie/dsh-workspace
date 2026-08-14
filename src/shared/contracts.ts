export const DEVICE_SCOPES = [
  'chat.read',
  'chat.write',
  'files.read',
  'files.write',
  'files.delete',
  'settings.read',
  'settings.write',
] as const

export type DeviceScope = (typeof DEVICE_SCOPES)[number]

export interface RootView {
  id: string
  label: string
  createdAt: number
}

export interface DeviceView {
  id: string
  name: string
  scopes: DeviceScope[]
  rootIds: string[]
  createdAt: number
  lastSeenAt?: number
  revokedAt?: number
}

export interface FileEntryView {
  name: string
  path: string
  kind: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modifiedAt: number
  writable: boolean
}

export interface WorkspaceEvent {
  id: string
  type: string
  time: number
  data: Record<string, unknown>
}

export interface AdminPrincipal {
  kind: 'admin'
  id: 'loopback-admin'
  scopes: ReadonlySet<DeviceScope>
  rootIds: 'all'
}

export interface DevicePrincipal {
  kind: 'device'
  id: string
  name: string
  scopes: ReadonlySet<DeviceScope>
  rootIds: ReadonlySet<string>
}

export type Principal = AdminPrincipal | DevicePrincipal

export const ADMIN_PRINCIPAL: AdminPrincipal = {
  kind: 'admin',
  id: 'loopback-admin',
  scopes: new Set(DEVICE_SCOPES),
  rootIds: 'all',
}
