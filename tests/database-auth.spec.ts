import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceDatabase } from '../src/host/database.ts'

const cleanup: string[] = []

afterEach(async () => {
  for (const target of cleanup.splice(0)) await rm(target, { recursive: true, force: true })
})

describe('device pairing database', () => {
  it('returns a token once and revokes it immediately', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-db-'))
    cleanup.push(base)
    const project = path.join(base, 'project')
    await mkdir(project)
    const database = new WorkspaceDatabase(path.join(base, 'state'))
    try {
      const root = await database.addRoot(project, 'Project')
      const pairing = database.createPairing([root.id], ['files.read', 'chat.read'])
      const exchanged = database.exchangePairing(pairing.code, 'Phone')
      const authenticated = database.authenticate(exchanged.token)
      expect(authenticated?.rootIds).toEqual([root.id])
      expect(authenticated?.scopes).toEqual(['files.read', 'chat.read'])
      expect(() => database.exchangePairing(pairing.code, 'Second phone')).toThrowError(/invalid, expired, or already used/i)
      database.revokeDevice(exchanged.device.id)
      expect(database.authenticate(exchanged.token)).toBeUndefined()
    } finally {
      database.close()
    }
  })

  it('does not grant roots added after pairing', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-db-root-'))
    cleanup.push(base)
    const first = path.join(base, 'first')
    const second = path.join(base, 'second')
    await mkdir(first)
    await mkdir(second)
    const database = new WorkspaceDatabase(path.join(base, 'state'))
    try {
      const firstRoot = await database.addRoot(first)
      const pairing = database.createPairing([firstRoot.id], ['files.read'])
      const exchanged = database.exchangePairing(pairing.code, 'Phone')
      await database.addRoot(second)
      expect(database.authenticate(exchanged.token)?.rootIds).toEqual([firstRoot.id])
    } finally {
      database.close()
    }
  })
})
