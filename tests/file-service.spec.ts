import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceDatabase } from '../src/host/database.ts'
import { FileService } from '../src/host/file-service.ts'

const cleanup: string[] = []

afterEach(async () => {
  for (const target of cleanup.splice(0)) await rm(target, { recursive: true, force: true })
})

describe('file service', () => {
  it('creates, saves with ETags, trashes, and restores a file', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-files-'))
    cleanup.push(base)
    const database = new WorkspaceDatabase(path.join(base, 'state'))
    const events: string[] = []
    const files = new FileService(database, event => events.push(event.type))
    try {
      const root = await database.addRoot(base, 'Temporary')
      await files.createEntry(root, 'hello.txt', 'file')
      const empty = await files.inspectContent(root, 'hello.txt')
      const saved = await files.writeContent(root, 'hello.txt', new TextEncoder().encode('hello'), { ifMatch: empty.etag })
      await expect(files.writeContent(root, 'hello.txt', new TextEncoder().encode('stale'), { ifMatch: empty.etag }))
        .rejects.toMatchObject({ code: 'ETAG_MISMATCH' })
      expect(await readFile(path.join(base, 'hello.txt'), 'utf8')).toBe('hello')
      const trash = await files.trashEntry(root, 'hello.txt')
      expect(files.listTrash().map(item => item.id)).toContain(trash.id)
      await files.restoreTrash(root, trash.id)
      expect(await readFile(path.join(base, 'hello.txt'), 'utf8')).toBe('hello')
      expect(saved.etag).not.toBe(empty.etag)
      expect(events).toEqual(expect.arrayContaining(['file.created', 'file.changed', 'file.trashed', 'file.restored']))
    } finally {
      database.close()
    }
  })

  it('preserves a conflicting restore destination', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-restore-'))
    cleanup.push(base)
    const database = new WorkspaceDatabase(path.join(base, 'state'))
    const files = new FileService(database, () => undefined)
    try {
      const root = await database.addRoot(base)
      await writeFile(path.join(base, 'value.txt'), 'old')
      const trash = await files.trashEntry(root, 'value.txt')
      await writeFile(path.join(base, 'value.txt'), 'new')
      await expect(files.restoreTrash(root, trash.id)).rejects.toMatchObject({ code: 'RESTORE_CONFLICT' })
      expect(await readFile(path.join(base, 'value.txt'), 'utf8')).toBe('new')
    } finally {
      database.close()
    }
  })
})
