import type { AgentUsage, Role } from '../types'
import { VESUVIUS } from './palette'

// The cast: which character each agent plays, and how each one is drawn in each status.

// One run of a sprite row: its text, and the part of the costume it is.
// `body` takes the role's color, `prop` a contrasting one (a brush, a lamp, a lens),
// `mask` is Pulcinella's black mask with his eyes on it.
export type Tone = 'body' | 'prop' | 'mask'
export type Run = { text: string; tone: Tone }
export type Sprite = readonly (readonly Run[])[]

// Every sprite row is this many cells wide, so the names beside them line up.
export const SPRITE_WIDTH = 10

export const ROLE_COLOR: Record<Role, string> = {
  pulcinella: '#F2EFE9',
  artist: VESUVIUS.lava,
  nerd: VESUVIUS.gulf,
  explorer: VESUVIUS.magma,
  reviewer: VESUVIUS.vineyard,
  guard: VESUVIUS.tuff,
  tester: VESUVIUS.sulfur,
  handyman: VESUVIUS.ash
}

// What the archive calls a group of them: one, and more than one.
export const ROLE_NAME: Record<Role, readonly [string, string]> = {
  pulcinella: ['Pulcinella', 'Pulcinella'],
  artist: ['Artista', 'Artisti'],
  nerd: ['Secchione', 'Secchioni'],
  explorer: ['Esploratore', 'Esploratori'],
  reviewer: ['Revisore', 'Revisori'],
  guard: ['Guardia', 'Guardie'],
  tester: ['Collaudatore', 'Collaudatori'],
  handyman: ['Tuttofare', 'Tuttofare']
}

// The words that cast a role, tried in this order: a security reviewer is a guard first.
const CASTING: readonly (readonly [Role, RegExp])[] = [
  ['guard', /secur|audit|pentest|vuln/i],
  ['reviewer', /review|critic|lint/i],
  ['tester', /\btest|\bqa\b|e2e|playwright/i],
  ['nerd', /plan|architect|design-doc|research|think|analy/i],
  ['explorer', /explor|search|find|locat|scout/i],
  ['artist', /front|\bui\b|\bux\b|design|css|style|react|interface|visual|figma/i]
]

function castBy(text: string): Role | undefined {
  return CASTING.find(([, words]) => words.test(text))?.[0]
}

// The role an agent plays: from its type first and, when the type says nothing, from its name.
export function roleOf(a: Pick<AgentUsage, 'id' | 'type' | 'label'>, mainId: string): Role {
  if (a.id === mainId) {
    return 'pulcinella'
  }

  return castBy(a.type) ?? castBy(a.label) ?? 'handyman'
}

const body = (text: string): Run => ({ text, tone: 'body' })
const prop = (text: string): Run => ({ text, tone: 'prop' })

// Pads a row with spaces to the sprite's width.
function padded(row: readonly Run[]): Run[] {
  const width = row.reduce((sum, run) => sum + [...run.text].length, 0)

  return width >= SPRITE_WIDTH ? [...row] : [...row, body(' '.repeat(SPRITE_WIDTH - width))]
}

// The eyes behind the face, three cells: open while it works, half-moons once done,
// crossed when it failed, lowered while it waits.
const EYES: Record<AgentUsage['status'], string> = {
  running: '███',
  waiting: '███',
  completed: '▀█▀',
  failed: '▚█▞',
  killed: '▚█▞',
  pending: '▄█▄',
  idle: '▄█▄'
}

// Pulcinella's eyes on his mask, two cells.
const MASK_EYES: Record<AgentUsage['status'], string> = {
  running: '••',
  waiting: '••',
  completed: '^^',
  failed: '°°',
  killed: '°°',
  pending: '──',
  idle: '──'
}

const isResting = (status: AgentUsage['status']): boolean =>
  status === 'failed' || status === 'killed' || status === 'pending' || status === 'idle'

// The character in a status: four rows, a hat (or nothing) over the face, the body and the feet.
export function spriteOf(role: Role, status: AgentUsage['status']): Sprite {
  const eyes = EYES[status]
  const face = [body(` ▐▛${eyes}▜▌`)]
  const torso = [body('▝▜█████▛▘')]
  const feet = [body(isResting(status) ? '  ▝▝ ▘▘' : '  ▘▘ ▝▝')]
  let rows: Run[][]

  switch (role) {
    case 'pulcinella':
      rows = [
        [body('   ▟▙')],
        [body('  ▐██▌')],
        [body(' ▐'), { text: ` ${MASK_EYES[status]} `, tone: 'mask' }, body('▌')],
        [body(`  ▝${status === 'failed' || status === 'killed' ? '~~' : '‿‿'}▘`)]
      ]
      break
    case 'artist':
      rows = [[body('  ▄▆▆▆▄ '), prop('╱')], face, torso, feet]
      break
    case 'nerd':
      rows = [[], [body(' ▐'), prop('◘═█═◘'), body('▌')], torso, feet]
      break
    case 'explorer':
      rows = [[body('  '), prop('◉'), body('▄▄▄')], face, torso, feet]
      break
    case 'reviewer':
      rows = [[], [body(` ▐▛${eyes.slice(0, 2)}`), prop('◎'), body('▜▌'), prop('╲')], torso, feet]
      break
    case 'guard':
      rows = [[body(' ▄▟███▙▄')], face, torso, feet]
      break
    case 'tester':
      rows = [[], [body(' ▐'), prop('▇▇█▇▇'), body('▌')], torso, feet]
      break
    case 'handyman':
      rows = [[body('  ▄▄▄▄▖')], face, torso, feet]
      break
    default:
      return role satisfies never
  }

  return rows.map(padded)
}
