import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { columns, Grid } from './engine/grid'
import { parseScene } from './engine/parse'
import { drawScene, positionOn } from './engine/render'

const HOME = '/home/tester'
const USER_DIR = `${HOME}/.claude/cozy/scenes`

const PENGUIN = `name: penguin
caption: a penguin goes for a waddle

[sprite penguin]
path: walk 0,2 -> 30,2
speed: 2
frames:
|🐧

[layer ice]
at: 0,3
repeat: yes
art:
|▔
`

const BROKEN = `name: oops

[sprite a]
path: zigzag 0,0 -> 4,0
frames:
|x
`

// Stands in for the engine: a home folder, a scene folder and an empty store.
function world(on: On, files: Record<string, string>, writes: Record<string, string> = {}) {
  const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.list', (_, e) => ({
    value: Object.keys(files)
      .filter(p => dirOf(p) === e.path || (e.path.endsWith('/scenes') && !e.path.startsWith(HOME) && p.startsWith('builtin/')))
      .map(p => ({ name: p.split('/').pop() ?? p, kind: 'file' as const, size: (files[p] ?? '').length, mtimeMs: 1, isLink: false })),
  }))
  on('fs.read', (_, e) => {
    const hit = Object.entries(files).find(([p]) => e.path === p || e.path.endsWith('/scenes/' + p.split('/').pop()))
    if (hit) return { value: hit[1] }
    if (e.path.endsWith('templates/new-scene.cozy')) return { value: 'name: NAME\ncaption: CAPTION\n\n[sprite s]\nframes:\n|o\n' }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_, e) => ({ value: e.path in files || e.path in writes }))
  on('fs.write', (_, e) => {
    writes[e.path] = e.text
    return { value: undefined }
  })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('store.delete', () => ({ value: undefined }))
  on('clock.now', () => ({ value: Date.UTC(2026, 0, 1, 12) }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'cozy' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Thinking…</Text>
  })
}

// The test kit fills in where the command came from.
const cozy = (args: string) => ({ command: 'cozy', args }) as never

const SPINNER = {
  plugin: 'cozy',
  component: 'Spinner',
  props: { word: 'Thinking', message: null, suffix: '…', mode: 'thinking' },
} as const

// ---- engine -------------------------------------------------------------

test('emoji take two columns and drawing over half of one clears it', async () => {
  expect(columns('🐧a')).toBe(3)
  const g = new Grid(6, 1)
  g.draw(0, 0, ['🐧🐧'], () => null)
  g.set(1, 0, 'x', null)
  expect(g.text()[0]).toBe(' x🐧  ')
})

test('a flipbook needs nothing but frames', async () => {
  const { scene, errors } = parseScene('(o.o)\n---\n(-.-)\n', 'blink.cozy')
  expect(errors).toEqual([])
  expect(scene?.name).toBe('blink')
  expect(scene?.width).toBe(5)
  expect(drawScene(scene!, { seconds: 0, isNight: false, sinceTool: -1 }).text()).toEqual(['(o.o)'])
  expect(drawScene(scene!, { seconds: 0.6, isNight: false, sinceTool: -1 }).text()).toEqual(['(-.-)'])
})

test('a broken scene is skipped and names the line', async () => {
  const { scene, errors } = parseScene(BROKEN, 'oops.cozy')
  expect(scene).toBe(null)
  expect(errors[0]?.line).toBe(4)
  expect(errors[0]?.message).toContain('zigzag')
})

test('paths move things the way they say', async () => {
  expect(positionOn({ kind: 'bounce', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }, 15).x).toBe(5)
  const arc = { kind: 'arc' as const, from: { x: 0, y: 2 }, to: { x: 20, y: 2 }, over: 10, height: 2, reach: 4 }
  expect(positionOn(arc, 10).y).toBe(0)
  expect(positionOn(arc, 2).y).toBe(2)
})

test('on: tool things show only right after a tool call', async () => {
  const { scene } = parseScene('[sprite fish]\non: tool\nframes:\n|><>\n', 'f.cozy')
  expect(drawScene(scene!, { seconds: 1, isNight: false, sinceTool: -1 }).text()[0]).not.toContain('><>')
  expect(drawScene(scene!, { seconds: 1, isNight: false, sinceTool: 0.5 }).text()[0]).toContain('><>')
})

// ---- the mod in a session -----------------------------------------------

test('the spinner shows a scene above the engine line', async ($, on) => {
  world(on, { 'builtin/penguin.cozy': PENGUIN })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...SPINNER, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /▔▔▔/ }))?.text).toContain('▔')
  expect((await ui.find({ type: 'Text', text: /waddle/ }))?.text).toContain('a penguin goes for a waddle')
  expect((await ui.find({ type: 'Text', text: /Thinking/ }))?.text).toBe('Thinking…')
  await ui.unmount()
})

test('/cozy off hands the spinner back', async ($, on) => {
  world(on, { 'builtin/penguin.cozy': PENGUIN })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(cozy('off'))

  const ui = await $.ui.mount({ ...SPINNER, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /▔/ })).toBe(undefined)
  await ui.unmount()
})

test('/cozy check points at the broken line in your file', async ($, on) => {
  world(on, { 'builtin/penguin.cozy': PENGUIN, [`${USER_DIR}/oops.cozy`]: BROKEN })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const out = await $.command.run(cozy('check'))
  expect(JSON.stringify(out)).toContain('oops.cozy:4')
})

test('/cozy new writes a starter scene into your folder', async ($, on) => {
  const writes: Record<string, string> = {}
  world(on, { 'builtin/penguin.cozy': PENGUIN }, writes)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(cozy('new Space Cat'))
  expect(writes[`${USER_DIR}/space-cat.cozy`]).toContain('name: Space Cat')
})
