import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AuthService } from '../src/host/auth.ts'
import { DshChatAdapter } from '../src/host/chat-adapter.ts'
import { WorkspaceDatabase } from '../src/host/database.ts'
import { WorkspaceEventBus } from '../src/host/event-bus.ts'
import { FileService } from '../src/host/file-service.ts'
import { ApiRouter } from '../src/host/router.ts'
import { RemoteApiServer } from '../src/host/server.ts'
import { DshSettingsAdapter } from '../src/host/settings-adapter.ts'

const port = Number(process.env.PORT ?? 43991)
const base = await mkdtemp(path.join(os.tmpdir(), 'daw-e2e-'))
const project = path.join(base, 'project')
await mkdir(path.join(project, 'src'), { recursive: true })
await writeFile(path.join(project, 'src', 'sample.ts'), 'export const answer = 42\n')
await writeFile(path.join(project, 'README.md'), '# E2E workspace\n')

const database = new WorkspaceDatabase(path.join(base, 'state'))
await database.addRoot(project, 'E2E project')
const events = new WorkspaceEventBus()
const auth = new AuthService(database)
const files = new FileService(database, event => events.emit(event))
const chat = new DshChatAdapter(fakeApi() as never, database)
const settings = new DshSettingsAdapter(fakeApi() as never)
let router!: ApiRouter
const remote = new RemoteApiServer({
  port,
  database,
  auth,
  chat,
  events,
  handle: (req, res) => router.handle(req, res),
})
router = new ApiRouter({ database, auth, files, chat, settings, remote, maxUploadBytes: 20 * 1024 * 1024 })
await remote.start()
console.log(`DSH workspace test server: http://127.0.0.1:${remote.status().port}/workspace`)

let stopping = false
const stop = async (): Promise<void> => {
  if (stopping) return
  stopping = true
  await remote.stop()
  database.close()
  await rm(base, { recursive: true, force: true })
  process.exit(0)
}
process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })

function fakeApi() {
  const empty = async function* () { /* test server has no DSH chat stream */ }
  return {
    sessions: {
      list: async (request: { rpcId: string }) => ({ rpcId: request.rpcId, result: { ok: true, value: { items: [] } } }),
    },
    events: { mux: empty, host: empty },
  }
}
