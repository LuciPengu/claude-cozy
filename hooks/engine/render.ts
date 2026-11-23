// Draws one frame of a scene at a moment in time. Pure: the same scene and
// moment always give the same frame, which is what lets frames be cached
// and particles drift smoothly instead of jumping around.

import { columns, Grid } from './grid'
import type { DrawnLine, Frame, FrameContext, Item, Particles, Path, Point, Scene, Sprite } from './types'

/** How long an `on: tool` thing stays up after a tool call, in seconds. */
export const TOOL_FLASH = 2.5

const fract = (x: number) => x - Math.floor(x)
const mod = (a: number, n: number) => ((a % n) + n) % n
/** A stable pseudo-random number in [0, 1) for (seed, i, salt). */
const rand = (seed: number, i: number, salt: number) =>
  fract(Math.sin(seed * 12.9898 + i * 78.233 + salt * 37.719) * 43758.5453)

const span = (a: Point, b: Point) => Math.max(1, Math.abs(b.x - a.x), Math.abs(b.y - a.y))
const lerp = (a: Point, b: Point, p: number): Point => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p })

/** Where a moving thing is after travelling `dist` cells along its path. */
export function positionOn(path: Path, dist: number): Point {
  switch (path.kind) {
    case 'still':
      return path.at
    case 'walk': {
      const len = span(path.from, path.to)
      return lerp(path.from, path.to, mod(dist, len) / len)
    }
    case 'bounce': {
      const len = span(path.from, path.to)
      const q = mod(dist, len * 2)
      return lerp(path.from, path.to, (q <= len ? q : len * 2 - q) / len)
    }
    case 'hop': {
      const len = span(path.from, path.to)
      const p = lerp(path.from, path.to, mod(dist, len) / len)
      return { x: p.x, y: p.y - Math.round(path.height * Math.abs(Math.sin((Math.PI * dist) / 2))) }
    }
    case 'wave': {
      const len = span(path.from, path.to)
      const p = lerp(path.from, path.to, mod(dist, len) / len)
      return { x: p.x, y: p.y - Math.round(path.height * Math.sin((2 * Math.PI * dist) / 8)) }
    }
    case 'arc': {
      const len = span(path.from, path.to)
      const p = lerp(path.from, path.to, mod(dist, len) / len)
      const d = Math.abs(p.x - path.over) / Math.max(0.5, path.reach)
      const lift = d < 1 ? path.height * (1 - d * d) : 0
      return { x: p.x, y: p.y - Math.round(lift) }
    }
    case 'orbit': {
      const r = Math.max(1, Math.abs(path.radius.x), Math.abs(path.radius.y))
      const a = dist / r
      return { x: path.center.x + path.radius.x * Math.cos(a), y: path.center.y + path.radius.y * Math.sin(a) }
    }
  }
}

/** Which frame a sprite shows at `seconds`; with `blink`, its last frame flashes once per period. */
export function frameOf(sprite: Sprite, seconds: number): Frame | undefined {
  const frames = sprite.frames
  if (sprite.blink > 0 && frames.length > 1) {
    if (mod(seconds, sprite.blink) < 0.3) return frames[frames.length - 1]
    const loop = frames.length - 1
    return frames[Math.floor(seconds * sprite.fps) % loop]
  }
  return frames[Math.floor(seconds * sprite.fps) % frames.length]
}

function colorFor(scene: Scene, item: Item, frame: Frame | null) {
  const base = item.color
  if (!frame?.mask) return () => base
  const mask = frame.mask
  return (col: number, row: number) => {
    const letter = Array.from(mask[row] ?? '')[col]
    if (!letter || letter === ' ' || letter === '.') return base
    return scene.palette[letter] ?? base
  }
}

function isShown(item: Item, ctx: FrameContext) {
  if (item.when === 'night' && !ctx.isNight) return false
  if (item.when === 'day' && ctx.isNight) return false
  if (item.on === 'tool' && !(ctx.sinceTool >= 0 && ctx.sinceTool < TOOL_FLASH)) return false
  return true
}

function drawParticles(grid: Grid, p: Particles, seconds: number) {
  const { x, y, w, h } = p.area
  const glyph = (i: number, cycle: number) => p.glyphs[mod(i + cycle, p.glyphs.length)] ?? '*'
  for (let i = 0; i < p.count; i++) {
    const phase = rand(p.seed, i, 1)
    const bx = rand(p.seed, i, 2) * w
    switch (p.motion) {
      case 'fall':
      case 'rise': {
        const travel = seconds * p.speed * (0.7 + rand(p.seed, i, 3) * 0.6) + phase * h
        const cycle = Math.floor(travel / h)
        const dy = mod(travel, h)
        const px = x + mod(Math.floor(bx + cycle * 7.3), w)
        const py = p.motion === 'fall' ? y + dy : y + h - 1 - dy
        grid.set(Math.floor(px), Math.floor(py), glyph(i, cycle), p.color)
        break
      }
      case 'drift': {
        const travel = seconds * p.speed * (0.6 + rand(p.seed, i, 3) * 0.8) + phase * w
        const cycle = Math.floor(travel / w)
        const px = x + mod(travel, w)
        const py = y + mod(Math.floor(rand(p.seed, i, 4) * h + cycle), h)
        grid.set(Math.floor(px), Math.floor(py), glyph(i, cycle), p.color)
        break
      }
      case 'twinkle': {
        const lit = Math.sin(seconds * p.speed * 2 + phase * Math.PI * 2)
        if (lit > 0.2) {
          const py = y + Math.floor(rand(p.seed, i, 4) * h)
          grid.set(Math.floor(x + bx), py, glyph(i, lit > 0.8 ? 0 : 1), p.color)
        }
        break
      }
    }
  }
}

export function drawScene(scene: Scene, ctx: FrameContext): Grid {
  const grid = new Grid(scene.width, scene.height)
  const seconds = ctx.seconds * scene.tempo
  const placed = new Map<string, Point>()

  for (const item of scene.items) {
    if (!isShown(item, ctx)) continue
    if (item.kind === 'layer') {
      const art = item.art
      const artW = Math.max(1, ...art.rows.map(columns))
      const colorAt = colorFor(scene, item, art)
      if (item.scroll === 0 && !item.repeat) {
        grid.draw(item.at.x, item.at.y, art.rows, colorAt)
      } else {
        const offset = mod(Math.floor(seconds * item.scroll), artW)
        for (let x = item.at.x + offset - artW; x < scene.width; x += artW) {
          grid.draw(x, item.at.y, art.rows, colorAt)
        }
      }
    } else if (item.kind === 'sprite') {
      const frame = frameOf(item, seconds)
      if (!frame) continue
      let at: Point
      if (item.follow) {
        const target = placed.get(item.follow.id)
        if (!target) continue
        at = { x: target.x + item.follow.offset.x, y: target.y + item.follow.offset.y }
      } else {
        at = item.path ? positionOn(item.path, seconds * item.speed) : { x: 0, y: 0 }
      }
      const rounded = { x: Math.round(at.x), y: Math.round(at.y) }
      placed.set(item.id, rounded)
      grid.draw(rounded.x, rounded.y, frame.rows, colorFor(scene, item, frame))
    } else {
      drawParticles(grid, item, seconds)
    }
  }
  return grid
}

/** A small cache, since the spinner and the gallery often draw the same frame. */
const cache = new Map<string, DrawnLine[]>()

export function frameLines(scene: Scene, ctx: FrameContext, key: string): DrawnLine[] {
  const toolUp = ctx.sinceTool >= 0 && ctx.sinceTool < TOOL_FLASH
  const k = `${key}|${Math.round(ctx.seconds * 8)}|${ctx.isNight ? 1 : 0}|${toolUp ? 1 : 0}`
  const hit = cache.get(k)
  if (hit) return hit
  const lines = drawScene(scene, ctx).lines()
  cache.set(k, lines)
  if (cache.size > 48) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  return lines
}
