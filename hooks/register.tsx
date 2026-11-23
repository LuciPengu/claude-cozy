// cozy: little animated scenes in place of YouTube while Claude works.
// No model calls and no prompt changes: it costs zero tokens.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { loadLibrary, sceneKey } from './engine/loader'
import type { Library, SceneDir } from './engine/loader'
import { frameLines } from './engine/render'
import type { Scene } from './engine/types'

const clock = atom({ plugin: 'cozy', key: 'clock' } as const, 0)
const current = atom({ plugin: 'cozy', key: 'scene' } as const, '')
const isOn = atom({ plugin: 'cozy', key: 'isOn' } as const, true)
const toolAt = atom({ plugin: 'cozy', key: 'toolAt' } as const, -100)
const libraryVersion = atom({ plugin: 'cozy', key: 'library' } as const, 0)
const galleryIndex = atom({ plugin: 'cozy', key: 'gallery' } as const, 0)

const PANE = 'cozy-gallery'
const FRAME_MS = 125
const SPEEDS: Record<string, number> = { calm: 0.65, normal: 1, lively: 1.4 }
// The animation leans into what Claude is doing: slower while it thinks,
// a little quicker while tools run.
const MODE_TEMPO: Record<string, number> = {
  thinking: 0.75, requesting: 0.9, responding: 1, 'tool-input': 1.1, 'tool-use': 1.25,
}

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const shortPath = (p: string, home: string) => (home && p.startsWith(home) ? '~' + p.slice(home.length) : p)
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function isNightNow(ms: number) {
  try {
    const h = new Date(ms).getHours()
    return h >= 20 || h < 6
  } catch {
    return false
  }
}

// Module state. A reload starts it over; the atoms above and $.store keep
// what has to survive.
const S = {
  speed: 1,
  onlyFavorites: false,
  showCaption: true,
  library: { scenes: [], errors: [], stamp: '' } as Library,
  dirs: [] as SceneDir[],
  home: '',
  userDir: '',
  seconds: 0,
  isBusy: false,
  isGalleryOpen: false,
  mode: 'responding',
  isNight: false,
  favorites: [] as string[],
  hidden: [] as string[],
  pinned: null as string | null,
}

const find = (name: string) => S.library.scenes.find(s => s.name.toLowerCase() === name.toLowerCase())

async function refresh($: EngineInterface) {
  const next = await loadLibrary($, S.dirs)
  const changed = next.stamp !== S.library.stamp
  S.library = next
  if (changed) await update($, libraryVersion, v => v + 1)
}

async function loadPrefs($: EngineInterface) {
  S.favorites = asList(await $.store.get('favorites'))
  S.hidden = asList(await $.store.get('hidden'))
  const p = await $.store.get('pinned')
  S.pinned = typeof p === 'string' ? p : null
}

function eligible(): Scene[] {
  const visible = S.library.scenes.filter(s => !S.hidden.includes(s.name))
  const pool = S.onlyFavorites ? visible.filter(s => S.favorites.includes(s.name)) : visible
  return pool.length ? pool : visible.length ? visible : S.library.scenes
}

async function shuffle($: EngineInterface) {
  const pool = eligible()
  const now = await read($, current)
  const others = pool.length > 1 ? pool.filter(s => s.name !== now) : pool
  const pick = others[Math.floor(Math.random() * others.length)]
  if (pick) await update($, current, () => pick.name)
  return pick
}

async function setFlag($: EngineInterface, key: 'favorites' | 'hidden', name: string) {
  const list = key === 'favorites' ? S.favorites : S.hidden
  const nextList = list.includes(name) ? list.filter(n => n !== name) : [...list, name]
  if (key === 'favorites') S.favorites = nextList
  else S.hidden = nextList
  await $.store.set(key, nextList)
  await update($, libraryVersion, v => v + 1)
}

async function pin($: EngineInterface, name: string | null) {
  S.pinned = name
  if (name) await $.store.set('pinned', name)
  else await $.store.delete('pinned')
  if (name) await update($, current, () => name)
}

export const register: Register = (on, options) => {
  S.speed = SPEEDS[String(options.speed ?? 'normal')] ?? 1
  S.onlyFavorites = options.scenes === 'favorites'
  S.showCaption = options.caption !== 'no'

  on('session.start', async ($, e, next) => {
    S.home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
    S.userDir = S.home ? `${S.home}/.claude/cozy/scenes` : ''
    S.dirs = [{ path: `${$.plugin.root}/scenes`, isBuiltIn: true }]
    if (S.userDir) S.dirs.push({ path: S.userDir, isBuiltIn: false })
    S.seconds = await read($, clock)
    S.isNight = isNightNow(await $.clock.now())
    S.isGalleryOpen = (await $.ui.panes()).some(p => p.id === PANE)
    await loadPrefs($)
    await refresh($)
    if (!(await read($, current))) await shuffle($)

    await $.command.register({
      name: 'cozy',
      description: 'Cute animations while Claude works. /cozy help for options',
    })

    $.clock.every(FRAME_MS, () => {
      if (!S.isBusy && !S.isGalleryOpen) return
      S.seconds += (FRAME_MS / 1000) * S.speed * (S.isBusy ? (MODE_TEMPO[S.mode] ?? 1) : 1)
      void update($, clock, () => S.seconds)
    })
    $.clock.every(60_000, async () => {
      S.isNight = isNightNow(await $.clock.now())
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    S.isBusy = true
    await refresh($)
    if (S.pinned && find(S.pinned)) await update($, current, () => S.pinned ?? '')
    else await shuffle($)
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    S.isBusy = true
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    S.isBusy = true
    await update($, toolAt, () => S.seconds)
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    S.isBusy = false
    return next(e)
  })

  on('turn.abort', ($, e, next) => {
    S.isBusy = false
    return next(e)
  })

  on('ui.close', ($, e, next) => {
    if (e.id === PANE) S.isGalleryOpen = false
    return next(e)
  })

  // ---- the spinner ------------------------------------------------------

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await read($, isOn))) return next(e)
    S.mode = e.props.mode
    await read($, libraryVersion)
    const scene = find(await read($, current)) ?? S.library.scenes[0]
    if (!scene) return next(e)

    const t = await read($, clock)
    const lastTool = await read($, toolAt)
    const lines = frameLines(scene, { seconds: t, isNight: S.isNight, sinceTool: t - lastTool }, sceneKey(scene))
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {lines.map((runs, i) => (
          <Box key={`l${i}`} flexDirection="row">
            {runs.map((run, j) => (
              <Text key={`r${j}`} color={run.color ?? undefined}>
                {run.text}
              </Text>
            ))}
          </Box>
        ))}
        {S.showCaption && <Text dimColor>{`  ${scene.caption}`}</Text>}
        {await next(e)}
      </Box>
    )
  })

  // ---- the gallery pane -------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, libraryVersion)
    const scenes = S.library.scenes
    if (scenes.length === 0) return <Text dimColor>No scenes found.</Text>
    const index = ((await read($, galleryIndex)) % scenes.length + scenes.length) % scenes.length
    const scene = scenes[index]
    if (!scene) return <Text dimColor>No scenes found.</Text>

    const t = await read($, clock)
    const lines = frameLines(scene, { seconds: t, isNight: S.isNight, sinceTool: -1 }, `gallery:${sceneKey(scene)}`)
    const isFav = S.favorites.includes(scene.name)
    const isHidden = S.hidden.includes(scene.name)
    const go = (d: number) => () => update($, galleryIndex, i => i + d)

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{scene.name}</Text>
          <Text dimColor>{`  ${index + 1}/${scenes.length}  ${scene.isBuiltIn ? 'built-in' : 'yours'}`}</Text>
          {isFav ? <Text color="#ffd36b">{'  ★ favorite'}</Text> : null}
          {isHidden ? <Text dimColor>{'  S.hidden'}</Text> : null}
          {S.pinned === scene.name ? <Text color="#7ed957">{'  S.pinned'}</Text> : null}
        </Text>
        <Text dimColor>{scene.caption}</Text>
        <Text> </Text>
        {lines.map((runs, i) => (
          <Box key={`g${i}`} flexDirection="row">
            {runs.map((run, j) => (
              <Text key={`gr${j}`} color={run.color ?? undefined}>
                {run.text}
              </Text>
            ))}
          </Box>
        ))}
        <Text> </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="prev" label="‹ Prev" onPress={go(-1)} />
          <Button key="next" label="Next ›" onPress={go(1)} />
          <Button key="fav" label={isFav ? '☆ Unfavorite' : '★ Favorite'} onPress={() => setFlag($, 'favorites', scene.name)} />
        </Box>
        <Box flexDirection="row" gap={1}>
          <Button key="pin" label={S.pinned === scene.name ? 'Unpin' : 'Pin'} onPress={() => pin($, S.pinned === scene.name ? null : scene.name)} />
          <Button key="hide" label={isHidden ? 'Unhide' : 'Hide'} onPress={() => setFlag($, 'hidden', scene.name)} />
          <Button key="close" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {S.library.errors.length > 0 ? (
          <Text color="#ff9a3c">{`${S.library.errors.length} problem(s) in your scene files: /cozy check`}</Text>
        ) : null}
      </Box>
    )
  })

  // ---- /cozy ------------------------------------------------------------

  const HELP = [
    '/cozy              switch to another scene',
    '/cozy <name>       pin a scene (it plays every turn)',
    '/cozy shuffle      unpin, back to a random scene each turn',
    '/cozy list         every scene, ★ S.favorites',
    '/cozy gallery      browse, favorite, hide and pin in a side pane',
    '/cozy new <name>   start your own scene file',
    '/cozy check        find mistakes in your scene files',
    '/cozy off | on     hide or show the animations',
  ].join('\n')

  on('command.run', { command: 'cozy' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = verb.toLowerCase()
    const restText = rest.join(' ').trim()

    switch (arg) {
      case 'help':
        return { text: HELP }
      case 'off':
        await update($, isOn, () => false)
        return { text: 'cozy is off. /cozy on brings it back.' }
      case 'on':
        await update($, isOn, () => true)
        return { text: 'cozy is on.' }
      case '':
      case 'next': {
        await refresh($)
        const pick = await shuffle($)
        return { text: pick ? `Up next: ${pick.caption}.` : 'No scenes found.' }
      }
      case 'shuffle':
        await pin($, null)
        return { text: 'Shuffling: a random scene each turn.' }
      case 'list': {
        await refresh($)
        const rows = S.library.scenes.map(s =>
          `${S.favorites.includes(s.name) ? '★' : ' '} ${s.name}${s.isBuiltIn ? '' : ' (yours)'}${S.hidden.includes(s.name) ? ' (S.hidden)' : ''}${S.pinned === s.name ? ' (S.pinned)' : ''}`,
        )
        return { text: rows.join('\n') || 'No scenes found.' }
      }
      case 'gallery': {
        await refresh($)
        S.isGalleryOpen = true
        const opened = await $.ui.open({ id: PANE, title: 'cozy gallery' })
        return { text: opened.isPlaced ? 'Gallery open.' : 'Gallery is waiting for room: widen the terminal.' }
      }
      case 'check': {
        await refresh($)
        const mine = S.library.scenes.filter(s => !s.isBuiltIn).length
        const head = `${S.library.scenes.length} scenes (${mine} yours). Your folder: ${shortPath(S.userDir, S.home)}`
        if (S.library.errors.length === 0) return { text: `${head}\nNo problems found.` }
        const lines = S.library.errors.slice(0, 12).map(er => `${shortPath(er.file, S.home)}:${er.line}  ${er.message}`)
        const more = S.library.errors.length > 12 ? `\n...and ${S.library.errors.length - 12} more` : ''
        return { text: `${head}\n${lines.join('\n')}${more}` }
      }
      case 'new': {
        const name = restText || 'my scene'
        const file = slug(name) || 'my-scene'
        if (!S.userDir) return { text: 'Could not find your S.home folder to save the scene in.' }
        const path = `${S.userDir}/${file}.cozy`
        if (await $.fs.exists(path)) return { text: `${shortPath(path, S.home)} already exists. Pick another name.` }
        const template = await $.fs.read(`${$.plugin.root}/templates/new-scene.cozy`)
        await $.fs.write(path, template.replace('name: NAME', `name: ${name}`).replace('caption: CAPTION', `caption: ${name}`))
        await refresh($)
        await pin($, name)
        return { text: `Made ${shortPath(path, S.home)} and S.pinned it. Edit and save; changes show on the next turn.` }
      }
      default: {
        await refresh($)
        const wanted = [verb, ...rest].join(' ')
        const hit = find(wanted) ?? S.library.scenes.find(s => s.name.toLowerCase().startsWith(wanted.toLowerCase()))
        if (!hit) return { text: `No scene called "${wanted}". /cozy list shows them all.` }
        await pin($, hit.name)
        return { text: `Pinned ${hit.name}: ${hit.caption}. /cozy shuffle to mix again.` }
      }
    }
  })
}
