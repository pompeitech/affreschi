import type { Mood } from '../types'

// Pulcinella himself: his hat, his face in each mood and frame, and what he says.

// Tokens spent with him (cache reads included) at which his hat grows a level.
export const LEVELS = [0, 1_000_000, 10_000_000, 50_000_000, 200_000_000] as const

// What he says in each mood; `{what}` is the command or tool the moment is about.
export const QUOTES: Record<Mood, readonly string[]> = {
  idle: ['Pronto, comandate!', 'Che facimmo mo?', 'Stongo cca, guagliò.'],
  working: ['Sto faticanno…', "Nu mumento, sto 'mpastanno.", 'Lassame lavorà!'],
  happy: ['Tutto verde, guagliò!', 'Che bellezza, passa tutto!', "Jamme, n'ata vittoria!"],
  worried: [
    'Mannaggia… {what} è caduto.',
    'Uè, {what} nun va.',
    "Nun te preoccupà, {what} s'aggiusta."
  ],
  stunned: ['Mamma mia, {what}!', 'Chesto è nu terremoto: {what}!'],
  sleeping: ['Zzz… sveglieme quanno serve.', 'Pennichella…']
}

// Pulcinella in pixel art, fourteen pixels wide. One letter per pixel: `.` is see-through,
// and each other letter a color of the costume.
export const PIXEL_COLOR: Record<string, string> = {
  W: '#F4F1EA',
  w: '#C9C4BA',
  K: '#151413',
  S: '#E9B48C',
  P: '#F2A3A0',
  R: '#D9573B',
  Y: '#F2C14E',
  B: '#6B4A33',
  C: '#2E86AB'
}

export const SPRITE_WIDTH = 14

// At rest: the floppy hat leaning right, the black half mask, pink cheeks, the white blouse.
const IDLE: readonly string[] = [
  '..........WW..',
  '........WWWW..',
  '......WWWWW...',
  '....WWWWWW....',
  '...WWWWWWW....',
  '..wWWWWWWWWw..',
  '.KKKKKKKKKKKK.',
  '.KKWWKKKKWWKK.',
  '.KKWKKKKKWKKK.',
  '..SSSSKKSSSS..',
  '..SPSSKKSSPS..',
  '...SSSRRSSS...',
  '....SSSSSS....',
  '...WwWWWWwW...',
  '..WWWWKKWWWW..',
  '..WW.WWWW.WW..'
]

// A frame as the rows it changes, by index, over the resting one.
type Edits = Readonly<Record<number, string>>

const SWAYED_HAT: Edits = {
  0: '............WW',
  1: '..........WWWW',
  2: '........WWWWW.',
  3: '......WWWWWW..',
  4: '....WWWWWWW...'
}

// Two frames per mood, swapped on the animation's beat.
const FRAMES: Record<Mood, readonly [Edits, Edits]> = {
  idle: [{}, {}],
  working: [
    { 9: '..SSSSKKSSSS.Y', 10: '..SPSSKKSSPSB.' },
    { ...SWAYED_HAT, 11: '...SSSRRSSS..Y', 12: '....SSSSSS..B.' }
  ],
  happy: [
    { 7: '.KKKWKKKKKWKK.', 8: '.KKWKWKKKWKWK.', 11: '...SRRRRRRS...', 12: '....SRRRRS....' },
    {
      0: '.Y........WW..',
      1: '.Y......WWWW..',
      7: '.KKKWKKKKKWKK.',
      8: '.KKWKWKKKWKWK.',
      11: '...SRRRRRRS...',
      12: '....SRRRRS....'
    }
  ],
  worried: [
    { 7: '.KKKWWKKWWKKK.', 8: '.KKKWKKKKWKKK.', 11: '...SSSSSSSS...', 12: '....SRRRRS....' },
    {
      7: '.KKKWWKKWWKKKC',
      8: '.KKKWKKKKWKKK.',
      11: '...SSSSSSSS...',
      12: '....SRRRRS....'
    }
  ],
  stunned: [
    { 7: '.KWWWKKKWWWKK.', 8: '.KWKWKKKWKWKK.', 11: '...SSRRRSSS...', 12: '....SRRRSS....' },
    {
      0: '.Y........WW..',
      1: '.Y......WWWW..',
      2: '......WWWWW...',
      3: '.Y..WWWWWW....',
      7: '.KWWWKKKWWWKK.',
      8: '.KWKWKKKWKWKK.',
      11: '...SSRRRSSS...',
      12: '....SRRRSS....'
    }
  ],
  sleeping: [
    { 0: '..........WW.Y', 7: '.KKKKKKKKKKKK.', 8: '.KKWWKKKKWWKK.', 11: '...SSSRSSSS...' },
    {
      0: '..........WWYY',
      1: '........WWWW.Y',
      7: '.KKKKKKKKKKKK.',
      8: '.KKWWKKKKWWKK.',
      11: '...SSSRSSSS...'
    }
  ]
}

// Closed eyes, for a blink now and then while he rests.
const BLINK: Edits = { 7: '.KKKKKKKKKKKK.', 8: '.KKWWKKKKWWKK.' }

// His pixels in a mood at a beat of the animation, his hat a pixel taller for every level past
// the first, and an even number of rows, so they pair up into character cells.
export function spriteOf(mood: Mood, tick: number, level: number): string[] {
  const frame = FRAMES[mood][tick % 2 === 0 ? 0 : 1]
  const blink = mood === 'idle' && tick % 12 === 11 ? BLINK : {}
  const body = IDLE.map((row, i) => blink[i] ?? frame[i] ?? row)
  const taller = Array.from({ length: Math.max(0, level - 1) }, () => '..........WW..')
  const rows = [...taller, ...body]

  return rows.length % 2 === 0 ? rows : ['.'.repeat(SPRITE_WIDTH), ...rows]
}

// One run of a character row: its text, the color of its glyphs, and the color behind them.
export type Cell = { text: string; color?: string; background?: string }

// Two pixel rows as one row of characters: each cell's upper pixel is the glyph's color and its
// lower pixel the background, so a terminal cell carries two pixels. Neighbouring cells of the
// same colors join into one run.
function cellRow(top: string, bottom: string): Cell[] {
  const cells: Cell[] = [...top].map((t, i) => {
    const up = PIXEL_COLOR[t]
    const down = PIXEL_COLOR[bottom[i] ?? '.']

    if (up === undefined && down === undefined) {
      return { text: ' ' }
    }

    if (up === undefined) {
      return { text: '▄', color: down }
    }

    if (down === undefined || down === up) {
      return { text: down === up ? '█' : '▀', color: up }
    }

    return { text: '▀', color: up, background: down }
  })

  const runs: Cell[] = []

  for (const cell of cells) {
    const last = runs.at(-1)

    if (last !== undefined && last.color === cell.color && last.background === cell.background) {
      last.text += cell.text
    } else {
      runs.push({ ...cell })
    }
  }

  return runs
}

// Pixel rows as character rows, two pixel rows to each.
export function cellsOf(pixels: readonly string[]): Cell[][] {
  return Array.from({ length: Math.ceil(pixels.length / 2) }, (_, i) =>
    cellRow(pixels[i * 2] ?? '', pixels[i * 2 + 1] ?? '.'.repeat(SPRITE_WIDTH))
  )
}

export function levelOf(spent: number): number {
  return LEVELS.filter(t => spent >= t).length
}

export function quoteFor(mood: Mood, what = '', pick = Math.random()): string {
  const lines = QUOTES[mood]
  const line = lines[Math.floor(pick * lines.length) % lines.length] ?? lines[0] ?? ''

  return line.replace('{what}', what)
}

// The command a Bash call ran, cut to a few words, or the tool's name when it ran none.
export function labelOf(tool: string, command: string | undefined): string {
  if (command === undefined) {
    return tool
  }

  const short = command.trim().split(/\s+/).slice(0, 3).join(' ')

  return short.length > 28 ? `${short.slice(0, 27)}…` : short
}

export function linesOf(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}
