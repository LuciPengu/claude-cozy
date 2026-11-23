# cozy

Little animated scenes that play above Claude Code's spinner while Claude works. Something calm to look at instead of opening YouTube.

```
       ··   ·
              ·
   🐧             ··*
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  a penguin goes for a waddle
✻ Thinking…
```

It ships with nine scenes: a penguin, a polar bear, sheep jumping a fence, a cat with yarn, fish, a bunny, coffee on a rainy day, a campfire and a night sky. Each turn picks one. You can make your own in a small text file.

Some details:

- **It reacts to Claude.** Scenes slow down while Claude thinks and speed up while tools run. Every tool call sets off a small surprise: the penguin catches a fish, a mouse runs past the cat, sparks jump from the fire.
- **Day and night.** After 8 pm the moon comes out and the polar bear falls asleep.
- **Zero tokens.** cozy never calls a model and never touches the prompt. It only draws on your screen. It ticks 8 times a second, and only while Claude is working.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install cozy --marketplace LuciPengu/claude-cozy
```

Answer `y` to add the marketplace, then pick a scope (user is the usual one).

From a shell:

```
claude plugin install cozy --marketplace LuciPengu/claude-cozy
```

In the desktop app, where `/plugin` doesn't run: click + next to the prompt box, then Plugins, Add marketplace with `LuciPengu/claude-cozy`, then Add plugin. The scenes draw in the terminal.

## Commands

| Command | What it does |
| --- | --- |
| `/cozy` | switch to another scene now |
| `/cozy <name>` | pin a scene so it plays every turn |
| `/cozy shuffle` | unpin, back to a random scene each turn |
| `/cozy list` | every scene, with ★ on favorites |
| `/cozy gallery` | a side pane to browse, favorite, hide and pin scenes |
| `/cozy new <name>` | start your own scene file |
| `/cozy check` | find mistakes in your scene files, with line numbers |
| `/cozy off` / `/cozy on` | hide or show the animations |

Settings (in `/plugin`, or the config menu): **speed** (calm, normal, lively), **scenes** (all, or only your favorites) and **caption** (yes or no).

## Make your own scene

Your scenes live in `~/.claude/cozy/scenes/`, one `.cozy` file each. Save a file and it shows up on Claude's next turn, with no restart. `/cozy new <name>` makes a starter file for you. A scene of yours with the same name as a built-in one replaces it.

### The easy way: a flipbook

Draw frames, with a line of `---` between them:

```
name: blinky
caption: blinky says hi
fps: 2

  (o.o)
  ---
  (-.-)
```

Header lines go at the top, and all of them are optional:

| Setting | Meaning |
| --- | --- |
| `name:` | what `/cozy <name>` calls it (default: the file name) |
| `caption:` | the line under the scene |
| `fps:` | frames per second (default 2) |
| `color:` | `#hex` or a color name like `cyan` |
| `path:` | make the whole flipbook move (see paths below) |
| `speed:` | how fast it moves along the path, in cells per second |
| `blink:` | every this many seconds, flash the last frame once |

### The full way: layers, sprites and particles

A scene file can also have sections. They're drawn in order, so later ones go on top. Spaces are see-through. Art goes on lines that start with `|`, and everything after the `|` counts, spaces included.

```
name: penguin
caption: a penguin goes for a waddle
size: 34x4

[palette]
w = #e8f4ff
i = #a8dcff

[particles snow]
glyphs: * ·
count: 7
motion: fall
area: 0,0 34,3
color: w

[sprite penguin]
path: walk -2,2 -> 34,2
speed: 1.5
fps: 3
frames:
|🐧
---
| 🐧

[sprite fish]
on: tool
follow: penguin 3,0
frames:
|🐟

[layer ice]
at: 0,3
repeat: yes
color: i
art:
|▔
```

**Scene settings** (at the top): `name`, `caption`, `size` (columns x rows, default `34x4`, up to `80x10`), `tempo` (speeds the whole scene up or down, default 1).

**`[palette]`**: one letter per color, like `w = #e8f4ff`. Use the letter anywhere a color goes, or in a `mask:`.

**`[layer name]`**: a picture that stays put, or scrolls.

| Setting | Meaning |
| --- | --- |
| `art:` | the picture, on `\|` lines |
| `at:` | top-left corner as `x,y` (default `0,0`) |
| `repeat: yes` | tile it across the whole width |
| `scroll:` | slide it sideways, in cells per second (negative goes left) |
| `mask:` | colors per cell, on `\|` lines the same shape as the art, using palette letters (`.` keeps the layer's own color) |

**`[sprite name]`**: something with frames that can move.

| Setting | Meaning |
| --- | --- |
| `frames:` | the frames, on `\|` lines, with `---` between them |
| `fps:` | frames per second (default 2) |
| `blink:` | every this many seconds, flash the last frame once (good for eyes) |
| `path:` | how it moves (below). Without one it stays at `at:` |
| `speed:` | cells per second along the path (default 3) |
| `follow:` | stick to an earlier sprite, like `follow: penguin 3,0` |
| `mask:` | colors per cell, one mask for all frames or one per frame |

Paths:

| Path | Example | Motion |
| --- | --- | --- |
| `still` | `still 4,1` | stays put |
| `walk` | `walk -2,2 -> 34,2` | goes from a to b, then starts over |
| `bounce` | `bounce 10,2 -> 30,2` | goes back and forth |
| `hop` | `hop -2,2 -> 34,2 height 1` | walks with little hops |
| `wave` | `wave -2,1 -> 34,1 height 1` | walks in a gentle wave |
| `arc` | `arc -2,2 -> 34,2 over 15 height 2 reach 4` | jumps over the column `over` |
| `orbit` | `orbit 16,1 radius 6,1` | goes round in an oval |

**`[particles name]`**: lots of little things moving on their own.

| Setting | Meaning |
| --- | --- |
| `glyphs:` | the characters to use, split by spaces: `* ·` |
| `motion:` | `fall`, `rise`, `drift` or `twinkle` |
| `count:` | how many (default 5) |
| `speed:` | cells per second (default 1) |
| `area:` | where they live, as `x,y w,h` (default: the whole scene) |
| `seed:` | change it to shuffle where they start |

**Any section** can also take:

| Setting | Meaning |
| --- | --- |
| `color:` | a palette letter, `#hex` or a color name |
| `when: night` / `when: day` | only show it at night (8 pm to 6 am) or during the day |
| `on: tool` | show it for a couple of seconds each time Claude runs a tool |

Emoji take up two columns, and cozy keeps them lined up. Lines starting with `#` are notes. If a file has a mistake, cozy skips that file and `/cozy check` tells you the line. The nine built-in scenes in [`scenes/`](scenes/) are good examples to copy from.

## Contributing a scene

Made one you like? Open a pull request that adds it to `scenes/`. Keep it calm: slow movement, soft colors, nothing that flashes.

## License

MIT
