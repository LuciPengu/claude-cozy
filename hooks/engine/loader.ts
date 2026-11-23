// Finds .cozy files in the built-in folder and the person's own folder,
// parses each, and keeps the parse until the file's mtime changes.
// A scene of yours with the same name as a built-in one replaces it.

import type { EngineInterface } from 'claude-code'

import { parseScene } from './parse'
import type { ParseError, Scene } from './types'

export type SceneDir = { path: string; isBuiltIn: boolean }
export type Library = { scenes: Scene[]; errors: ParseError[]; stamp: string }

type Cached = { mtimeMs: number; size: number; scene: Scene | null; errors: ParseError[] }
const parsed = new Map<string, Cached>()

export async function loadLibrary($: EngineInterface, dirs: SceneDir[]): Promise<Library> {
  const byName = new Map<string, Scene>()
  const errors: ParseError[] = []
  const stamp: string[] = []

  for (const dir of dirs) {
    const entries = await $.fs.list(dir.path).catch(() => [])
    const files = entries
      .filter(e => e.kind === 'file' && e.name.toLowerCase().endsWith('.cozy'))
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of files) {
      const path = `${dir.path}/${entry.name}`
      stamp.push(`${path}@${entry.mtimeMs}:${entry.size}`)
      let hit = parsed.get(path)
      if (!hit || hit.mtimeMs !== entry.mtimeMs || hit.size !== entry.size) {
        if (entry.size > 256 * 1024) {
          hit = { mtimeMs: entry.mtimeMs, size: entry.size, scene: null, errors: [{ file: path, line: 1, message: 'file is over 256 KB; scenes are small text files' }] }
        } else {
          const text = await $.fs.read(path).catch(() => null)
          const result = text === null
            ? { scene: null, errors: [{ file: path, line: 1, message: 'could not read the file' }] }
            : parseScene(text, path, dir.isBuiltIn)
          hit = { mtimeMs: entry.mtimeMs, size: entry.size, ...result }
        }
        parsed.set(path, hit)
      }
      errors.push(...hit.errors)
      if (hit.scene) byName.set(hit.scene.name.toLowerCase(), hit.scene)
    }
  }

  return { scenes: [...byName.values()], errors, stamp: stamp.join('|') }
}

/** Cache key for a scene's frames: its file and when it last changed. */
export function sceneKey(scene: Scene): string {
  const hit = parsed.get(scene.source)
  return `${scene.source}@${hit?.mtimeMs ?? 0}`
}
