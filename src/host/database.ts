import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DeviceScope, DeviceView, RootView } from '../shared/contracts.ts'
import { DEVICE_SCOPES } from '../shared/contracts.ts'
import { ApiError } from './errors.ts'
import { canonicalRoot } from './path-policy.ts'

interface RootRow {
  id: string
  label: string
  real_path: string
  created_at: number
}

interface DeviceRow {
  id: string
  name: string
  token_hash: string
  scopes_json: string
  created_at: number
  last_seen_at: number | null
  revoked_at: number | null
}

export interface StoredRoot extends RootView {
  realPath: string
}

export interface AuthenticatedDevice extends DeviceView {
  tokenHash: string
}

export interface TrashRecord {
  id: string
  rootId: string
  relativePath: string
  payloadPath: string
  kind: string
  size: number
  digest: string
  createdAt: number
  status: string
}

export class WorkspaceDatabase {
  readonly dataDir: string
  readonly trashDir: string
  private readonly db: DatabaseSync

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir)
    this.trashDir = path.join(this.dataDir, 'trash')
    mkdirSync(this.trashDir, { recursive: true })
    this.db = new DatabaseSync(path.join(this.dataDir, 'workspace.sqlite'))
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value)
  }

  async addRoot(inputPath: string, label?: string): Promise<StoredRoot> {
    const realPath = await canonicalRoot(inputPath)
    const duplicate = this.db.prepare('SELECT * FROM roots WHERE real_path = ?').get(realPath) as RootRow | undefined
    if (duplicate !== undefined) return rootFromRow(duplicate)
    const id = randomUUID()
    const createdAt = Date.now()
    const resolvedLabel = label?.trim() || path.basename(realPath) || realPath
    this.db.prepare('INSERT INTO roots(id,label,real_path,created_at) VALUES(?,?,?,?)')
      .run(id, resolvedLabel, realPath, createdAt)
    this.audit('admin', 'loopback-admin', 'root.add', id, undefined, { label: resolvedLabel })
    return { id, label: resolvedLabel, realPath, createdAt }
  }

  listRoots(): StoredRoot[] {
    return (this.db.prepare('SELECT * FROM roots ORDER BY created_at, id').all() as unknown as RootRow[]).map(rootFromRow)
  }

  getRoot(id: string): StoredRoot | undefined {
    const row = this.db.prepare('SELECT * FROM roots WHERE id = ?').get(id) as RootRow | undefined
    return row === undefined ? undefined : rootFromRow(row)
  }

  removeRoot(id: string): void {
    const result = this.db.prepare('DELETE FROM roots WHERE id = ?').run(id)
    if (result.changes === 0) throw new ApiError(404, 'ROOT_NOT_FOUND', 'The authorized root does not exist.')
    this.audit('admin', 'loopback-admin', 'root.remove', id)
  }

  createPairing(rootIds: string[], scopes: DeviceScope[], ttlMs = 10 * 60_000): { code: string; expiresAt: number } {
    assertScopes(scopes)
    for (const rootId of rootIds) {
      if (this.getRoot(rootId) === undefined) throw new ApiError(404, 'ROOT_NOT_FOUND', `Unknown root ${rootId}.`)
    }
    const raw = randomBytes(5).toString('hex').toUpperCase()
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`
    const expiresAt = Date.now() + ttlMs
    this.db.prepare('INSERT INTO pairings(code_hash,scopes_json,roots_json,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(hashSecret(normalizePairingCode(code)), JSON.stringify(scopes), JSON.stringify(rootIds), expiresAt, Date.now())
    this.audit('admin', 'loopback-admin', 'pairing.create', undefined, undefined, { rootIds, scopes, expiresAt })
    return { code, expiresAt }
  }

  exchangePairing(code: string, deviceName: string): { token: string; device: DeviceView } {
    const normalized = normalizePairingCode(code)
    const now = Date.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db.prepare(
        'SELECT code_hash,scopes_json,roots_json,expires_at,used_at FROM pairings WHERE code_hash = ?',
      ).get(hashSecret(normalized)) as {
        code_hash: string
        scopes_json: string
        roots_json: string
        expires_at: number
        used_at: number | null
      } | undefined
      if (row === undefined || row.used_at !== null || row.expires_at < now) {
        throw new ApiError(401, 'PAIRING_INVALID', 'The pairing code is invalid, expired, or already used.')
      }
      const token = randomBytes(32).toString('base64url')
      const id = randomUUID()
      const name = deviceName.trim().slice(0, 120) || 'Mobile device'
      const scopes = parseScopes(row.scopes_json)
      const rootIds = JSON.parse(row.roots_json) as string[]
      this.db.prepare('UPDATE pairings SET used_at = ? WHERE code_hash = ?').run(now, row.code_hash)
      this.db.prepare('INSERT INTO devices(id,name,token_hash,scopes_json,created_at) VALUES(?,?,?,?,?)')
        .run(id, name, hashSecret(token), JSON.stringify(scopes), now)
      const grant = this.db.prepare('INSERT INTO device_roots(device_id,root_id) VALUES(?,?)')
      for (const rootId of rootIds) grant.run(id, rootId)
      this.db.exec('COMMIT')
      const device: DeviceView = { id, name, scopes, rootIds, createdAt: now }
      this.audit('device', id, 'pairing.exchange', undefined, undefined, { name })
      return { token, device }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  authenticate(token: string): AuthenticatedDevice | undefined {
    const row = this.db.prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL')
      .get(hashSecret(token)) as DeviceRow | undefined
    if (row === undefined) return undefined
    return this.hydrateDevice(row, true)
  }

  getActiveDevice(id: string): AuthenticatedDevice | undefined {
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ? AND revoked_at IS NULL')
      .get(id) as DeviceRow | undefined
    return row === undefined ? undefined : this.hydrateDevice(row, false)
  }

  private hydrateDevice(row: DeviceRow, touchLastSeen: boolean): AuthenticatedDevice {
    const rootRows = this.db.prepare('SELECT root_id FROM device_roots WHERE device_id = ? ORDER BY root_id')
      .all(row.id) as unknown as { root_id: string }[]
    const now = Date.now()
    if (touchLastSeen) this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, row.id)
    return {
      id: row.id,
      name: row.name,
      tokenHash: row.token_hash,
      scopes: parseScopes(row.scopes_json),
      rootIds: rootRows.map(item => item.root_id),
      createdAt: row.created_at,
      ...(touchLastSeen ? { lastSeenAt: now } : row.last_seen_at === null ? {} : { lastSeenAt: row.last_seen_at }),
    }
  }

  listDevices(): DeviceView[] {
    const rows = this.db.prepare('SELECT * FROM devices ORDER BY created_at DESC').all() as unknown as DeviceRow[]
    const rootQuery = this.db.prepare('SELECT root_id FROM device_roots WHERE device_id = ? ORDER BY root_id')
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      scopes: parseScopes(row.scopes_json),
      rootIds: (rootQuery.all(row.id) as unknown as { root_id: string }[]).map(item => item.root_id),
      createdAt: row.created_at,
      ...(row.last_seen_at === null ? {} : { lastSeenAt: row.last_seen_at }),
      ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
    }))
  }

  isDeviceActive(id: string): boolean {
    return this.db.prepare('SELECT 1 AS active FROM devices WHERE id = ? AND revoked_at IS NULL').get(id) !== undefined
  }

  updateDevice(id: string, scopes: DeviceScope[], rootIds: string[]): DeviceView {
    assertScopes(scopes)
    for (const rootId of rootIds) {
      if (this.getRoot(rootId) === undefined) throw new ApiError(404, 'ROOT_NOT_FOUND', `Unknown root ${rootId}.`)
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const changed = this.db.prepare('UPDATE devices SET scopes_json = ? WHERE id = ? AND revoked_at IS NULL')
        .run(JSON.stringify(scopes), id)
      if (changed.changes === 0) throw new ApiError(404, 'DEVICE_NOT_FOUND', 'The active device does not exist.')
      this.db.prepare('DELETE FROM device_roots WHERE device_id = ?').run(id)
      const grant = this.db.prepare('INSERT INTO device_roots(device_id,root_id) VALUES(?,?)')
      for (const rootId of rootIds) grant.run(id, rootId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.audit('admin', 'loopback-admin', 'device.update', undefined, undefined, { deviceId: id, scopes, rootIds })
    const device = this.listDevices().find(item => item.id === id)
    if (device === undefined) throw new ApiError(404, 'DEVICE_NOT_FOUND', 'The device does not exist.')
    return device
  }

  revokeDevice(id: string): void {
    const result = this.db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), id)
    if (result.changes === 0) throw new ApiError(404, 'DEVICE_NOT_FOUND', 'The active device does not exist.')
    this.audit('admin', 'loopback-admin', 'device.revoke', undefined, undefined, { deviceId: id })
  }

  insertTrash(record: TrashRecord): void {
    this.db.prepare(
      'INSERT INTO trash(id,root_id,relative_path,payload_path,kind,size,digest,created_at,status) VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(
      record.id,
      record.rootId,
      record.relativePath,
      record.payloadPath,
      record.kind,
      record.size,
      record.digest,
      record.createdAt,
      record.status,
    )
  }

  updateTrashStatus(id: string, status: string): void {
    this.db.prepare('UPDATE trash SET status = ? WHERE id = ?').run(status, id)
  }

  getTrash(id: string): TrashRecord | undefined {
    const row = this.db.prepare('SELECT * FROM trash WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row === undefined ? undefined : trashFromRow(row)
  }

  listTrash(rootIds?: ReadonlySet<string>): TrashRecord[] {
    const rows = this.db.prepare('SELECT * FROM trash WHERE status != ? ORDER BY created_at DESC').all('restored') as unknown as Record<string, unknown>[]
    return rows.map(trashFromRow).filter(item => rootIds === undefined || rootIds.has(item.rootId))
  }

  deleteTrashRecord(id: string): void {
    this.db.prepare('DELETE FROM trash WHERE id = ?').run(id)
  }

  audit(
    actorType: string,
    actorId: string,
    action: string,
    rootId?: string,
    relativePath?: string,
    details: Record<string, unknown> = {},
    requestId?: string,
  ): void {
    this.db.prepare(
      'INSERT INTO audit(id,time,request_id,actor_type,actor_id,action,root_id,relative_path,details_json) VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(randomUUID(), Date.now(), requestId ?? null, actorType, actorId, action, rootId ?? null, relativePath ?? null, JSON.stringify(details))
  }

  listAudit(limit = 200): Record<string, unknown>[] {
    return this.db.prepare(
      'SELECT id,time,request_id AS requestId,actor_type AS actorType,actor_id AS actorId,action,root_id AS rootId,relative_path AS relativePath,details_json AS detailsJson FROM audit ORDER BY time DESC LIMIT ?',
    ).all(Math.min(Math.max(limit, 1), 1000)) as unknown as Record<string, unknown>[]
  }

  readIdempotent(deviceId: string, key: string): { status: number; body: unknown } | undefined {
    const row = this.db.prepare('SELECT status,response_json FROM idempotency WHERE device_id = ? AND key = ?')
      .get(deviceId, key) as { status: number; response_json: string } | undefined
    return row === undefined ? undefined : { status: row.status, body: JSON.parse(row.response_json) }
  }

  saveIdempotent(deviceId: string, key: string, status: number, body: unknown): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO idempotency(device_id,key,status,response_json,created_at) VALUES(?,?,?,?,?)',
    ).run(deviceId, key, status, JSON.stringify(body), Date.now())
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS roots(
        id TEXT PRIMARY KEY, label TEXT NOT NULL, real_path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        scopes_json TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS device_roots(
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        root_id TEXT NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
        PRIMARY KEY(device_id, root_id)
      );
      CREATE TABLE IF NOT EXISTS pairings(
        code_hash TEXT PRIMARY KEY, scopes_json TEXT NOT NULL, roots_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS trash(
        id TEXT PRIMARY KEY, root_id TEXT NOT NULL, relative_path TEXT NOT NULL,
        payload_path TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL,
        digest TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit(
        id TEXT PRIMARY KEY, time INTEGER NOT NULL, request_id TEXT, actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL, action TEXT NOT NULL, root_id TEXT, relative_path TEXT, details_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency(
        device_id TEXT NOT NULL, key TEXT NOT NULL, status INTEGER NOT NULL,
        response_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(device_id,key)
      );
      CREATE INDEX IF NOT EXISTS audit_time_idx ON audit(time DESC);
      CREATE INDEX IF NOT EXISTS trash_root_idx ON trash(root_id, created_at DESC);
    `)
  }
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

function normalizePairingCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

function parseScopes(value: string): DeviceScope[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed.filter((scope): scope is DeviceScope => DEVICE_SCOPES.includes(scope as DeviceScope))
}

function assertScopes(scopes: DeviceScope[]): void {
  if (scopes.some(scope => !DEVICE_SCOPES.includes(scope))) {
    throw new ApiError(400, 'SCOPE_INVALID', 'The request contains an unknown device scope.')
  }
}

function rootFromRow(row: RootRow): StoredRoot {
  return { id: row.id, label: row.label, realPath: row.real_path, createdAt: row.created_at }
}

function trashFromRow(row: Record<string, unknown>): TrashRecord {
  return {
    id: String(row.id),
    rootId: String(row.root_id),
    relativePath: String(row.relative_path),
    payloadPath: String(row.payload_path),
    kind: String(row.kind),
    size: Number(row.size),
    digest: String(row.digest),
    createdAt: Number(row.created_at),
    status: String(row.status),
  }
}
