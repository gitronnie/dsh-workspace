import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { ApiError } from './errors.ts'

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export interface ResolvedPath {
  absolutePath: string
  exists: boolean
  leafIsLink: boolean
}

export function validateRelativePath(value: string): string[] {
  if (typeof value !== 'string') throw new ApiError(400, 'PATH_INVALID', 'Relative path must be a string.')
  if (value.includes('\0')) throw new ApiError(400, 'PATH_INVALID', 'Relative path contains a null byte.')
  if (value.includes('\\')) throw new ApiError(400, 'PATH_INVALID', 'Wire paths must use forward slashes.')
  if (value.startsWith('/') || value.startsWith('//') || /^[A-Za-z]:/.test(value)) {
    throw new ApiError(400, 'PATH_INVALID', 'Absolute, drive-letter, and UNC paths are forbidden.')
  }
  if (value === '') return []
  const segments = value.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new ApiError(400, 'PATH_INVALID', 'Relative path contains an empty or forbidden segment.')
    }
    if (process.platform === 'win32') {
      if (segment.includes(':') || /[. ]$/.test(segment) || WINDOWS_RESERVED.test(segment)) {
        throw new ApiError(400, 'PATH_INVALID', 'Relative path contains a name unsupported on Windows.')
      }
    }
  }
  return segments
}

export async function canonicalRoot(input: string): Promise<string> {
  let canonical: string
  try {
    canonical = await realpath(path.resolve(input))
  } catch {
    throw new ApiError(400, 'ROOT_INVALID', 'The authorized root does not exist or cannot be resolved.')
  }
  const info = await stat(canonical)
  if (!info.isDirectory()) throw new ApiError(400, 'ROOT_INVALID', 'The authorized root must be a directory.')
  return canonical
}

export async function resolveAuthorizedPath(
  root: string,
  relativePath: string,
  options: { allowMissingLeaf?: boolean; allowLeafLink?: boolean } = {},
): Promise<ResolvedPath> {
  const segments = validateRelativePath(relativePath)
  let current = root
  if (segments.length === 0) return { absolutePath: root, exists: true, leafIsLink: false }

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index] as string)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const isLeaf = index === segments.length - 1
      if (code === 'ENOENT' && isLeaf && options.allowMissingLeaf === true) {
        return { absolutePath: current, exists: false, leafIsLink: false }
      }
      if (code === 'ENOENT') throw new ApiError(404, 'PATH_NOT_FOUND', 'The requested path does not exist.')
      throw error
    }

    const isLeaf = index === segments.length - 1
    if (info.isSymbolicLink()) {
      if (!isLeaf || options.allowLeafLink !== true) {
        throw new ApiError(403, 'LINK_TRAVERSAL_FORBIDDEN', 'Symbolic links and junctions cannot be traversed.')
      }
      return { absolutePath: current, exists: true, leafIsLink: true }
    }
    if (!isLeaf && !info.isDirectory()) {
      throw new ApiError(400, 'PATH_NOT_DIRECTORY', 'An intermediate path segment is not a directory.')
    }
  }

  if (!isPathInside(root, current)) throw new ApiError(403, 'PATH_OUTSIDE_ROOT', 'The path escaped its authorized root.')
  return { absolutePath: current, exists: true, leafIsLink: false }
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function wireRelative(root: string, candidate: string): string | undefined {
  if (!isPathInside(root, candidate)) return undefined
  return path.relative(root, candidate).split(path.sep).join('/')
}

export function parentWirePath(relativePath: string): string {
  const segments = validateRelativePath(relativePath)
  segments.pop()
  return segments.join('/')
}
