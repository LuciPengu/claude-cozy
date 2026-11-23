// A cell grid that knows emoji take two columns in a terminal.
// A wide glyph owns its cell and the one after it (marked TAIL), so
// anything drawn over half of it clears the other half instead of
// shifting the rest of the line.

import type { DrawnLine, Run } from './types'

const TAIL = '\u0000'

type Cell = { ch: string; color: string | null }

/** Terminal column width of one grapheme: 2 for emoji and CJK, else 1. */
export function widthOf(g: string): number {
  const cp = g.codePointAt(0) ?? 0
  if (g.includes('️')) return 2
  if (cp >= 0x1f000 && cp <= 0x1faff) return 2
  if (cp >= 0x2600 && cp <= 0x27bf) return WIDE_MISC.has(cp) ? 2 : 1
  if (cp >= 0x1100 && cp <= 0x115f) return 2
  if (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) return 2
  if (cp >= 0xac00 && cp <= 0xd7a3) return 2
  if (cp >= 0xf900 && cp <= 0xfaff) return 2
  if (cp >= 0xfe30 && cp <= 0xfe4f) return 2
  if (cp >= 0xff00 && cp <= 0xff60) return 2
  if (cp >= 0xffe0 && cp <= 0xffe6) return 2
  return 1
}

// Symbols in the U+2600 block that terminals draw two columns wide
// (they default to emoji presentation).
const WIDE_MISC = new Set([
  0x2614, 0x2615, 0x2648, 0x2649, 0x264a, 0x264b, 0x264c, 0x264d, 0x264e, 0x264f, 0x2650,
  0x2651, 0x2652, 0x2653, 0x267f, 0x2693, 0x26a1, 0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26c4,
  0x26c5, 0x26ce, 0x26d4, 0x26ea, 0x26f2, 0x26f3, 0x26f5, 0x26fa, 0x26fd, 0x2705, 0x270a,
  0x270b, 0x2728, 0x274c, 0x274e, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797,
  0x27b0, 0x27bf, 0x2b50, 0x2b55,
])

/** Splits text into graphemes, keeping emoji with their modifiers together. */
export function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter
  if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(text), s => s.segment)
  const out: string[] = []
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0) ?? 0
    const joins = cp === 0xfe0f || cp === 0x200d || (cp >= 0x1f3fb && cp <= 0x1f3ff)
    const prev = out[out.length - 1]
    if (prev !== undefined && (joins || prev.endsWith('‍'))) out[out.length - 1] = prev + ch
    else out.push(ch)
  }
  return out
}

/** Total terminal columns of a string. */
export function columns(text: string): number {
  return graphemes(text).reduce((n, g) => n + widthOf(g), 0)
}

export class Grid {
  readonly width: number
  readonly height: number
  private cells: Cell[][]

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.cells = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({ ch: ' ', color: null })),
    )
  }

  private clear(row: Cell[], x: number) {
    const cell = row[x]
    if (!cell) return
    if (cell.ch === TAIL && x > 0) {
      const head = row[x - 1]
      if (head) head.ch = ' '
    } else if (cell.ch !== TAIL) {
      const next = row[x + 1]
      if (next && next.ch === TAIL) next.ch = ' '
    }
  }

  /** Puts one grapheme at (x, y). Off-grid or half-off glyphs are dropped. */
  set(x: number, y: number, g: string, color: string | null) {
    const row = this.cells[y]
    if (!row || x < 0) return
    const w = widthOf(g)
    if (x + w > this.width) return
    this.clear(row, x)
    if (w === 2) this.clear(row, x + 1)
    row[x] = { ch: g, color }
    if (w === 2) row[x + 1] = { ch: TAIL, color }
  }

  /**
   * Draws text with its top-left at (x, y). Spaces are see-through, so
   * art stacks on what is under it. `colorAt` picks each cell's color.
   */
  draw(x: number, y: number, rows: string[], colorAt: (col: number, row: number) => string | null) {
    const ox = Math.round(x)
    const oy = Math.round(y)
    rows.forEach((text, r) => {
      let cx = ox
      for (const g of graphemes(text)) {
        const w = widthOf(g)
        if (g !== ' ') this.set(cx, oy + r, g, colorAt(cx - ox, r))
        cx += w
      }
    })
  }

  /** The grid as lines of same-colored runs. */
  lines(): DrawnLine[] {
    return this.cells.map(row => {
      const runs: Run[] = []
      for (const cell of row) {
        if (cell.ch === TAIL) continue
        const color = cell.ch === ' ' ? null : cell.color
        const last = runs[runs.length - 1]
        if (last && (last.color === color || cell.ch === ' ')) last.text += cell.ch
        else runs.push({ text: cell.ch, color })
      }
      return runs
    })
  }

  /** Plain text, for tests and previews. */
  text(): string[] {
    return this.lines().map(runs => runs.map(r => r.text).join(''))
  }
}
