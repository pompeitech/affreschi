import type { AgentUsage, Role } from '../types'
import { ROLE_COLOR } from './cast'

// Each plugin is installed on its own. Keep the compact portrait with the cast.
const PULCINELLA = [
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

const INK: Record<string, string> = {
  W: '#F4F1EA',
  w: '#C9C4BA',
  K: '#151413',
  S: '#E9B48C',
  P: '#F2A3A0',
  R: '#D9573B'
}

const HATS: Record<Exclude<Role, 'pulcinella'>, string[]> = {
  handyman: ['...BBBBB....', '..BBBBBBBB..'],
  explorer: ['....WWW.....', '..BBWRWBBB..'],
  nerd: ['............', '...BBBBBB...'],
  artist: ['....BBBBB.W.', '..BBBBBB.W..'],
  reviewer: ['............', '...BBBBBB.W.'],
  guard: ['....BB......', '..BBBBBBBB..'],
  tester: ['...WWWWWW...', '..WWBBBBWW..']
}

export function avatarSvg(role: Role, status: AgentUsage['status']): string {
  const eyes = status === 'failed' || status === 'killed' ? 'R' : 'W'
  const rows =
    role === 'pulcinella'
      ? PULCINELLA
      : [
          ...HATS[role],
          '..BBBBBBBB..',
          role === 'nerd' ? '..BwwBBwwB..' : role === 'reviewer' ? '..BBWWBBwB..' : '..BBBBBBBB..',
          `..BB${eyes}BB${eyes}BB..`,
          '..BBBBBBBB..',
          '...BBBBBB...',
          '............',
          '.BBBBBBBBBB.',
          '..BBBBBBBB..',
          '...BB..BB...',
          '...BB..BB...'
        ]
  const scale = 2
  const left = Math.floor((40 - rows[0].length * scale) / 2)
  const top = Math.floor((40 - rows.length * scale) / 2)
  const pixels = rows
    .flatMap((row, y) =>
      [...row].map((pixel, x) => {
        const color = pixel === 'B' ? ROLE_COLOR[role] : INK[pixel]
        return color
          ? `<rect x="${left + x * scale}" y="${top + y * scale}" width="2" height="2" fill="${color}"/>`
          : ''
      })
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#293032"/>${pixels}</svg>`
}
