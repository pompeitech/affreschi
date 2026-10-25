import type { Mood } from '../types'
import { VESUVIUS } from './palette'

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

export const EMOTE_COLOR: Record<Mood, string> = {
  idle: VESUVIUS.ash,
  working: VESUVIUS.sulfur,
  happy: VESUVIUS.vineyard,
  worried: VESUVIUS.lava,
  stunned: VESUVIUS.magma,
  sleeping: VESUVIUS.ash
}

// Two frames per mood, swapped on the animation tick: he hammers, bobs, snores.
const EMOTES: Record<Mood, readonly [string, string]> = {
  idle: [' ', ' '],
  working: ['⚒', '⚒'],
  happy: ['♪', '♫'],
  worried: ['!', ' '],
  stunned: ['✦', '✧'],
  sleeping: ['z', 'Z']
}

// His eyes behind the mask and his mouth, two cells each.
const EYES: Record<Mood, readonly [string, string]> = {
  idle: ['••', '••'],
  working: ['••', '▪▪'],
  happy: ['^^', '^^'],
  worried: ['°°', '°°'],
  stunned: ['OO', 'oo'],
  sleeping: ['──', '──']
}

const MOUTH: Record<Mood, readonly [string, string]> = {
  idle: ['‿‿', '‿‿'],
  working: ['──', '▁▁'],
  happy: ['‿‿', '▽▽'],
  worried: ['~~', '~~'],
  stunned: ['oo', 'OO'],
  sleeping: ['..', 'oo']
}

export type Pose = { emote: string; eyes: string; mouth: string; lean: number }

// His pose at a tick: the mood's two frames in turn, and a blink now and then while idle.
export function poseOf(mood: Mood, tick: number): Pose {
  const f = tick % 2 === 0 ? 0 : 1
  const isBlink = mood === 'idle' && tick % 12 === 11

  return {
    emote: EMOTES[mood][f],
    eyes: isBlink ? '──' : EYES[mood][f],
    mouth: MOUTH[mood][f],
    // Working, he rocks with the hammer; happy, he bounces.
    lean: (mood === 'working' || mood === 'happy') && f === 1 ? 1 : 0
  }
}

export function levelOf(spent: number): number {
  return LEVELS.filter(t => spent >= t).length
}

// The hat, one row at level 1 and one more per level: the coppolone grows.
export function hatOf(level: number): string[] {
  if (level <= 1) {
    return ['  ▟██▙  ']
  }

  return ['   ▗▖   ', ...Array.from({ length: level - 2 }, () => '   ██   '), '  ▟██▙  ']
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
