// Parses .cozy scene files. Two shapes:
//
//  * a flipbook: plain frames split by `---` lines, with an optional
//    `name:` / `caption:` / `fps:` / `color:` / `path:` header;
//  * a scene: `[palette]`, `[layer id]`, `[sprite id]` and
//    `[particles id]` sections, art written on `|` lines.
//
// Every problem comes back with its line number. A file with any problem
// is skipped as a whole, so a half-broken scene never reaches the screen.

import { columns } from './grid'
import type {
  Frame, Item, Layer, Motion, Particles, ParseError, ParseResult, Path, Point, Scene, Sprite,
} from './types'

export const DEFAULT_WIDTH = 34
export const DEFAULT_HEIGHT = 4
export const MAX_WIDTH = 80
export const MAX_HEIGHT = 10

const SECTION = /^\[(palette|layer|sprite|particles)(?:\s+([A-Za-z0-9_-]+))?\]\s*$/
const KV = /^([a-z]+)\s*:\s*(.*)$/
const MOTIONS: readonly Motion[] = ['fall', 'rise', 'drift', 'twinkle']

const KEYS = {
  header: ['name', 'caption', 'size', 'tempo'],
  layer: ['at', 'scroll', 'repeat', 'color', 'when', 'on', 'art', 'mask'],
  sprite: ['frames', 'mask', 'fps', 'blink', 'path', 'at', 'speed', 'follow', 'color', 'when', 'on'],
  particles: ['glyphs', 'count', 'motion', 'speed', 'area', 'seed', 'color', 'when', 'on'],
} as const

const BLOCK_KEYS = new Set(['art', 'frames', 'mask'])

type Raw = { line: number; values: Map<string, { value: string; line: number }>; blocks: Map<string, { frames: string[][]; line: number }> }

class Errors {
  list: ParseError[] = []
  file: string
  constructor(file: string) {
    this.file = file
  }
  add(line: number, message: string) {
    this.list.push({ file: this.file, line, message })
  }
}

const baseName = (file: string) => (file.split('/').pop() ?? file).replace(/\.cozy$/i, '')

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function num(raw: string, line: number, errors: Errors, what: string, min = -Infinity, max = Infinity): number | null {
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(n)) {
    errors.add(line, `${what} should be a number, got "${raw}"`)
    return null
  }
  if (n < min || n > max) {
    errors.add(line, `${what} should be between ${min} and ${max}, got ${n}`)
    return null
  }
  return n
}

function point(raw: string, line: number, errors: Errors, what: string): Point | null {
  const m = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) {
    errors.add(line, `${what} should look like x,y (for example 4,2), got "${raw}"`)
    return null
  }
  return { x: Number(m[1]), y: Number(m[2]) }
}

function color(raw: string, line: number, errors: Errors, palette: Record<string, string>): string | null {
  const v = raw.trim()
  if (palette[v]) return palette[v] ?? null
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v
  if (/^[a-z]+$/i.test(v) && v.length > 1) return v.toLowerCase()
  errors.add(line, `color "${v}" is not a palette letter, a #hex color or a color name`)
  return null
}

/** `walk 0,2 -> 34,2`, `hop 0,2 -> 34,2 height 1`, `orbit 16,1 radius 6,1`, ... */
export function parsePath(raw: string, line: number, errors: Errors): Path | null {
  const words = raw.trim().split(/\s+/)
  const kind = words[0]
  const rest = words.slice(1).join(' ')
  const opt = (name: string, fallback: number) => {
    const m = rest.match(new RegExp(`\\b${name}\\s+(-?\\d+(?:\\.\\d+)?)`))
    return m ? Number(m[1]) : fallback
  }
  const fromTo = (): [Point, Point] | null => {
    const m = rest.match(/^(-?[\d.]+\s*,\s*-?[\d.]+)\s*->\s*(-?[\d.]+\s*,\s*-?[\d.]+)/)
    if (!m) {
      errors.add(line, `path "${kind}" needs a start and end, like: ${kind} 0,2 -> 30,2`)
      return null
    }
    const a = point(m[1] ?? '', line, errors, 'path start')
    const b = point(m[2] ?? '', line, errors, 'path end')
    return a && b ? [a, b] : null
  }
  switch (kind) {
    case 'still': {
      const at = point(rest, line, errors, 'still position')
      return at && { kind, at }
    }
    case 'walk':
    case 'bounce': {
      const ft = fromTo()
      return ft && { kind, from: ft[0], to: ft[1] }
    }
    case 'hop':
    case 'wave': {
      const ft = fromTo()
      return ft && { kind, from: ft[0], to: ft[1], height: opt('height', 1) }
    }
    case 'arc': {
      const ft = fromTo()
      if (!ft) return null
      if (!/\bover\s+-?\d/.test(rest)) {
        errors.add(line, 'arc needs the column to jump over, like: arc 0,2 -> 34,2 over 16 height 2')
        return null
      }
      return { kind, from: ft[0], to: ft[1], over: opt('over', 0), height: opt('height', 2), reach: opt('reach', 4) }
    }
    case 'orbit': {
      const m = rest.match(/^(-?[\d.]+\s*,\s*-?[\d.]+)\s+radius\s+(-?[\d.]+\s*,\s*-?[\d.]+)/)
      if (!m) {
        errors.add(line, 'orbit looks like: orbit 16,1 radius 6,1')
        return null
      }
      const center = point(m[1] ?? '', line, errors, 'orbit center')
      const radius = point(m[2] ?? '', line, errors, 'orbit radius')
      return center && radius && { kind, center, radius }
    }
    default:
      errors.add(line, `unknown path "${kind ?? ''}": use still, walk, bounce, hop, wave, arc or orbit`)
      return null
  }
}

const isBlank = (s: string) => s.trim() === ''

/** Lines that hold art: everything after the first `|`. */
const artLine = (s: string) => {
  const i = s.indexOf('|')
  return i >= 0 && s.slice(0, i).trim() === '' ? s.slice(i + 1) : null
}

function toFrames(block: string[][]): Frame[] {
  return block.map(rows => ({ rows, mask: null }))
}

function attachMasks(frames: Frame[], masks: string[][] | undefined, line: number, errors: Errors) {
  if (!masks) return
  if (masks.length !== 1 && masks.length !== frames.length) {
    errors.add(line, `mask has ${masks.length} frames but the art has ${frames.length}; give one mask, or one per frame`)
    return
  }
  frames.forEach((f, i) => {
    f.mask = masks[masks.length === 1 ? 0 : i] ?? null
  })
}

function parseFlipbook(text: string, file: string, isBuiltIn: boolean): ParseResult {
  const errors = new Errors(file)
  const lines = text.split('\n')
  const header = new Map<string, { value: string; line: number }>()
  let i = 0
  for (; i < lines.length; i++) {
    const l = lines[i] ?? ''
    if (/^#(\s|$)/.test(l)) continue
    const m = l.match(/^(name|caption|fps|color|path|speed|tempo|blink)\s*:\s*(.*)$/)
    if (!m) break
    header.set(m[1] ?? '', { value: (m[2] ?? '').trim(), line: i + 1 })
  }
  const body = lines.slice(i)
  while (body.length && isBlank(body[0] ?? '')) body.shift()
  while (body.length && isBlank(body[body.length - 1] ?? '')) body.pop()
  const frames: string[][] = [[]]
  for (const l of body) {
    if (l.trim() === '---') frames.push([])
    else frames[frames.length - 1]?.push(l.replace(/\s+$/, ''))
  }
  for (const f of frames) {
    while (f.length && isBlank(f[f.length - 1] ?? '')) f.pop()
  }
  const kept = frames.filter(f => f.length > 0)
  if (kept.length === 0) {
    errors.add(i + 1, 'no frames found: draw your art, and put a line with just --- between frames')
    return { scene: null, errors: errors.list }
  }

  const get = (k: string) => header.get(k)
  const fps = get('fps') ? num(get('fps')!.value, get('fps')!.line, errors, 'fps', 0.1, 30) : 2
  const speed = get('speed') ? num(get('speed')!.value, get('speed')!.line, errors, 'speed', 0, 60) : 3
  const tempo = get('tempo') ? num(get('tempo')!.value, get('tempo')!.line, errors, 'tempo', 0.1, 5) : 1
  const blink = get('blink') ? num(get('blink')!.value, get('blink')!.line, errors, 'blink', 0, 120) : 0
  const path = get('path') ? parsePath(get('path')!.value, get('path')!.line, errors) : null
  const col = get('color') ? color(get('color')!.value, get('color')!.line, errors, {}) : null

  const artW = Math.max(...kept.flatMap(f => f.map(columns)))
  const artH = Math.max(...kept.map(f => f.length))
  const width = Math.min(MAX_WIDTH, path ? Math.max(DEFAULT_WIDTH, artW) : artW)
  const height = Math.min(MAX_HEIGHT, artH + (path ? Math.max(0, pathBottom(path)) : 0))

  if (errors.list.length) return { scene: null, errors: errors.list }

  const sprite: Sprite = {
    kind: 'sprite', id: 'flipbook', line: i + 1, color: col, when: null, on: null,
    frames: toFrames(kept), fps: fps ?? 2, blink: blink ?? 0,
    path: path ?? { kind: 'still', at: { x: 0, y: 0 } }, speed: speed ?? 3, follow: null,
  }
  const name = get('name')?.value || baseName(file)
  return {
    scene: {
      name, caption: get('caption')?.value || name, width, height, tempo: tempo ?? 1,
      palette: {}, items: [sprite], source: file, isBuiltIn,
    },
    errors: [],
  }
}

function pathBottom(p: Path): number {
  switch (p.kind) {
    case 'still': return p.at.y
    case 'orbit': return p.center.y + Math.abs(p.radius.y)
    default: return Math.max(p.from.y, p.to.y)
  }
}

export function parseScene(text: string, file: string, isBuiltIn = false): ParseResult {
  const clean = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '')
  const hasSections = clean.split('\n').some(l => SECTION.test(l.trim()))
  if (!hasSections) return parseFlipbook(clean, file, isBuiltIn)

  const errors = new Errors(file)
  const lines = clean.split('\n')
  const header = new Map<string, { value: string; line: number }>()
  const paletteRaw: { key: string; value: string; line: number }[] = []
  const sections: (Raw & { kind: 'layer' | 'sprite' | 'particles'; id: string })[] = []
  let current: 'header' | 'palette' | (Raw & { kind: 'layer' | 'sprite' | 'particles'; id: string }) = 'header'
  let block: { frames: string[][]; line: number } | null = null
  const ids = new Set<string>()

  lines.forEach((rawLine, idx) => {
    const n = idx + 1
    const l = rawLine.trim()
    const art = artLine(rawLine)
    if (block && art !== null) {
      block.frames[block.frames.length - 1]?.push(art)
      return
    }
    if (block && l === '---') {
      block.frames.push([])
      return
    }
    block = null
    if (l === '' || l.startsWith('#')) return
    if (art !== null) {
      errors.add(n, 'art line (starting with |) outside an art:, frames: or mask: block')
      return
    }
    const sec = l.match(SECTION)
    if (sec) {
      const kind = sec[1] as 'palette' | 'layer' | 'sprite' | 'particles'
      if (kind === 'palette') {
        current = 'palette'
        return
      }
      const id = sec[2] ?? `${kind}${sections.length + 1}`
      if (ids.has(id)) errors.add(n, `two sections are both named "${id}"`)
      ids.add(id)
      current = { kind, id, line: n, values: new Map(), blocks: new Map() }
      sections.push(current)
      return
    }
    if (l.startsWith('[')) {
      errors.add(n, `unknown section "${l}": use [palette], [layer name], [sprite name] or [particles name]`)
      return
    }
    if (current === 'palette') {
      const m = l.match(/^(\S)\s*[=:]\s*(\S+)$/)
      if (!m) errors.add(n, 'palette lines look like: w = #e8f4ff')
      else paletteRaw.push({ key: m[1] ?? '', value: m[2] ?? '', line: n })
      return
    }
    const kv = l.match(KV)
    if (!kv) {
      errors.add(n, `expected "key: value", got "${l}"`)
      return
    }
    const key = kv[1] ?? ''
    const value = (kv[2] ?? '').trim()
    if (current === 'header') {
      if (!(KEYS.header as readonly string[]).includes(key)) errors.add(n, `unknown setting "${key}" (scene settings: ${KEYS.header.join(', ')})`)
      else header.set(key, { value, line: n })
      return
    }
    const allowed = KEYS[current.kind] as readonly string[]
    if (!allowed.includes(key)) {
      errors.add(n, `[${current.kind}] has no "${key}" (it takes: ${allowed.join(', ')})`)
      return
    }
    if (BLOCK_KEYS.has(key)) {
      if (value !== '') errors.add(n, `${key}: goes on its own line, with the art on | lines under it`)
      block = { frames: [[]], line: n }
      current.blocks.set(key, block)
      return
    }
    current.values.set(key, { value, line: n })
  })

  const palette: Record<string, string> = {}
  for (const p of paletteRaw) {
    const c = color(p.value, p.line, errors, {})
    if (c) palette[p.key] = c
  }

  const size = header.get('size')
  let width = DEFAULT_WIDTH
  let height = DEFAULT_HEIGHT
  if (size) {
    const m = size.value.match(/^(\d+)\s*x\s*(\d+)$/i)
    if (!m) errors.add(size.line, `size looks like 34x4, got "${size.value}"`)
    else {
      width = Number(m[1])
      height = Number(m[2])
      if (width < 4 || width > MAX_WIDTH || height < 1 || height > MAX_HEIGHT) {
        errors.add(size.line, `size must be between 4x1 and ${MAX_WIDTH}x${MAX_HEIGHT}`)
      }
    }
  }
  const tempoV = header.get('tempo')
  const tempo = tempoV ? num(tempoV.value, tempoV.line, errors, 'tempo', 0.1, 5) ?? 1 : 1

  const items: Item[] = []
  for (const s of sections) {
    const v = (k: string) => s.values.get(k)
    const common = {
      id: s.id,
      line: s.line,
      color: v('color') ? color(v('color')!.value, v('color')!.line, errors, palette) : null,
      when: null as 'day' | 'night' | null,
      on: null as 'tool' | null,
    }
    const when = v('when')
    if (when) {
      if (when.value === 'day' || when.value === 'night') common.when = when.value
      else errors.add(when.line, 'when: takes day or night')
    }
    const on = v('on')
    if (on) {
      if (on.value === 'tool') common.on = 'tool'
      else errors.add(on.line, 'on: takes tool (shows the thing for a moment each time Claude runs a tool)')
    }
    const nOr = (k: string, fallback: number, min: number, max: number) => {
      const x = v(k)
      return x ? num(x.value, x.line, errors, k, min, max) ?? fallback : fallback
    }
    const pOr = (k: string, fallback: Point) => {
      const x = v(k)
      return x ? point(x.value, x.line, errors, k) ?? fallback : fallback
    }

    if (s.kind === 'layer') {
      const art = s.blocks.get('art')
      if (!art) {
        errors.add(s.line, `[layer ${s.id}] needs an art: block`)
        continue
      }
      if (art.frames.length > 1) errors.add(art.line, 'a layer has one picture; use a [sprite] for frames')
      const frame: Frame = { rows: art.frames[0] ?? [], mask: null }
      const mask = s.blocks.get('mask')
      attachMasks([frame], mask?.frames, mask?.line ?? s.line, errors)
      const layer: Layer = { ...common, kind: 'layer', at: pOr('at', { x: 0, y: 0 }), scroll: nOr('scroll', 0, -60, 60), repeat: false, art: frame }
      const rep = v('repeat')
      if (rep) {
        if (rep.value === 'yes' || rep.value === 'no') layer.repeat = rep.value === 'yes'
        else errors.add(rep.line, 'repeat: takes yes or no')
      }
      items.push(layer)
    } else if (s.kind === 'sprite') {
      const art = s.blocks.get('frames')
      if (!art || art.frames.every(f => f.length === 0)) {
        errors.add(s.line, `[sprite ${s.id}] needs a frames: block`)
        continue
      }
      const frames = toFrames(art.frames.filter(f => f.length > 0))
      const mask = s.blocks.get('mask')
      attachMasks(frames, mask?.frames, mask?.line ?? s.line, errors)
      const pathV = v('path')
      const followV = v('follow')
      let follow: Sprite['follow'] = null
      if (followV) {
        const m = followV.value.match(/^([A-Za-z0-9_-]+)(?:\s+(-?\d+\s*,\s*-?\d+))?$/)
        if (!m) errors.add(followV.line, 'follow looks like: follow penguin 3,0')
        else {
          const target = m[1] ?? ''
          const prior = items.find(it => it.id === target && it.kind === 'sprite')
          if (!prior) errors.add(followV.line, `follow: "${target}" must be a [sprite] defined above this one`)
          follow = { id: target, offset: m[2] ? point(m[2], followV.line, errors, 'follow offset') ?? { x: 0, y: 0 } : { x: 0, y: 0 } }
        }
      }
      const path = pathV ? parsePath(pathV.value, pathV.line, errors) : { kind: 'still' as const, at: pOr('at', { x: 0, y: 0 }) }
      const sprite: Sprite = {
        ...common, kind: 'sprite', frames, fps: nOr('fps', 2, 0.1, 30), blink: nOr('blink', 0, 0, 120),
        path, speed: nOr('speed', 3, 0, 60), follow,
      }
      items.push(sprite)
    } else {
      const g = v('glyphs')
      if (!g || g.value === '') {
        errors.add(s.line, `[particles ${s.id}] needs glyphs: (for example: glyphs: * ·)`)
        continue
      }
      const m = v('motion')
      const motion = (m?.value ?? 'fall') as Motion
      if (!MOTIONS.includes(motion)) errors.add(m?.line ?? s.line, `motion: takes ${MOTIONS.join(', ')}`)
      const areaV = v('area')
      let area = { x: 0, y: 0, w: width, h: height }
      if (areaV) {
        const am = areaV.value.match(/^(-?\d+)\s*,\s*(-?\d+)\s+(\d+)\s*,\s*(\d+)$/)
        if (!am) errors.add(areaV.line, 'area looks like: x,y w,h (for example 0,0 34,3)')
        else area = { x: Number(am[1]), y: Number(am[2]), w: Math.max(1, Number(am[3])), h: Math.max(1, Number(am[4])) }
      }
      const particles: Particles = {
        ...common, kind: 'particles', glyphs: g.value.split(/\s+/), count: Math.round(nOr('count', 5, 1, 200)),
        motion, speed: nOr('speed', 1, 0, 60), area, seed: Math.round(nOr('seed', hash(s.id) % 1000, 0, 1e9)),
      }
      items.push(particles)
    }
  }

  if (items.length === 0 && errors.list.length === 0) errors.add(1, 'the scene has no [layer], [sprite] or [particles] sections')
  if (errors.list.length) return { scene: null, errors: errors.list }

  const name = header.get('name')?.value || baseName(file)
  const scene: Scene = {
    name, caption: header.get('caption')?.value || name, width, height, tempo,
    palette, items, source: file, isBuiltIn,
  }
  return { scene, errors: [] }
}
