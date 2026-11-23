// The parsed form of a .cozy scene file.

export type Point = { x: number; y: number }

export type Path =
  | { kind: 'still'; at: Point }
  | { kind: 'walk'; from: Point; to: Point }
  | { kind: 'bounce'; from: Point; to: Point }
  | { kind: 'hop'; from: Point; to: Point; height: number }
  | { kind: 'wave'; from: Point; to: Point; height: number }
  | { kind: 'arc'; from: Point; to: Point; over: number; height: number; reach: number }
  | { kind: 'orbit'; center: Point; radius: Point }

export type Motion = 'fall' | 'rise' | 'drift' | 'twinkle'

/** Art is rows of cells; a frame is one picture of it. */
export type Frame = { rows: string[]; mask: string[] | null }

type Common = {
  id: string
  line: number
  color: string | null
  when: 'day' | 'night' | null
  on: 'tool' | null
}

export type Layer = Common & {
  kind: 'layer'
  at: Point
  scroll: number
  repeat: boolean
  art: Frame
}

export type Sprite = Common & {
  kind: 'sprite'
  frames: Frame[]
  fps: number
  blink: number
  path: Path | null
  speed: number
  follow: { id: string; offset: Point } | null
}

export type Particles = Common & {
  kind: 'particles'
  glyphs: string[]
  count: number
  motion: Motion
  speed: number
  area: { x: number; y: number; w: number; h: number }
  seed: number
}

export type Item = Layer | Sprite | Particles

export type Scene = {
  name: string
  caption: string
  width: number
  height: number
  tempo: number
  palette: Record<string, string>
  items: Item[]
  source: string
  isBuiltIn: boolean
}

export type ParseError = { file: string; line: number; message: string }

export type ParseResult = { scene: Scene | null; errors: ParseError[] }

/** What the moment looks like when a frame is drawn. */
export type FrameContext = {
  seconds: number
  isNight: boolean
  sinceTool: number
}

export type Run = { text: string; color: string | null }
export type DrawnLine = Run[]
