import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dshDir = path.resolve(process.argv[2] ?? '../deepseek-harness')
const tarball = path.resolve(process.argv[3] ?? '')
if (process.argv[3] === undefined) throw new Error('Usage: tsx scripts/smoke-profile-install.ts <dsh-dir> <plugin.tgz>')

const dshHome = mkdtempSync(path.join(os.tmpdir(), 'daw-profile-smoke-'))
try {
  runDsh(['plugin', '--profile', 'web', 'add', tarball])
  const manifestPath = path.join(dshHome, 'profiles', 'web', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  if (manifest.dependencies?.['dsh-workspace'] === undefined) {
    throw new Error('The plugin was not recorded as a profile dependency.')
  }
  if (!manifest.dsh?.profile?.bundles?.includes('dsh-workspace')) {
    throw new Error('The plugin bundle was not activated in the web profile.')
  }
  const composed = runDsh(['web', '--dump-config'], true)
  if (!composed.includes('name: dsh-workspace')) {
    throw new Error('The composed DSH profile does not contain the workspace host row.')
  }
  console.log('profile-install: tarball installed, bundle activated, and DSH config composed')
} finally {
  rmSync(dshHome, { recursive: true, force: true })
}

function runDsh(args: string[], capture = false): string {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', ...args], {
    cwd: dshDir,
    env: { ...process.env, DSH_HOME: dshHome },
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`dsh ${args.join(' ')} failed (${result.status}): ${result.stderr}`)
  }
  return result.stdout ?? ''
}
