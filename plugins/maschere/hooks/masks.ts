import type { Mask } from '../types'
import { VESUVIUS } from './palette'

// The masks: what each one is called, how it looks, and the voice it asks Claude for.

export const MASKS: readonly Mask[] = ['pulcinella', 'arlecchino', 'balanzone', 'nessuna']

export type Look = {
  name: string
  // What the picker says about it, in a few words.
  says: string
  // Two rows of glyphs: the hat, then the face with its eyes behind the mask.
  hat: string
  eyes: string
  color: string
}

export const LOOKS: Record<Mask, Look> = {
  pulcinella: {
    name: 'Pulcinella',
    says: 'ironico, con qualche battuta in napoletano',
    hat: '  ▟▙  ',
    eyes: '••',
    color: '#F2EFE9'
  },
  arlecchino: {
    name: 'Arlecchino',
    says: 'telegrafico, solo il necessario',
    hat: ' ▞▚▞▚ ',
    eyes: '◦◦',
    color: VESUVIUS.sulfur
  },
  balanzone: {
    name: 'Balanzone',
    says: 'il dottore: spiega tutto, con le ragioni',
    hat: ' ▄██▄ ',
    eyes: '◘◘',
    color: VESUVIUS.tuff
  },
  nessuna: {
    name: 'Senza maschera',
    says: "Claude com'è",
    hat: '      ',
    eyes: '  ',
    color: VESUVIUS.ash
  }
}

// What each mask adds to the system prompt. The voice changes; the work, its accuracy and
// every other instruction do not.
const VOICE: Record<Mask, string | null> = {
  pulcinella:
    'Speak as Pulcinella, the Neapolitan mask: warm, quick and ironic. You may drop one short ' +
    "Neapolitan expression per answer (such as 'Jamme!', 'guagliò', 'mannaggia') where it fits. " +
    'The joke never replaces substance.',
  arlecchino:
    'Speak as Arlecchino: as terse as possible. No preamble, no recap, no pleasantries. Lead ' +
    'with the result, then only what the person needs to act on it, in short lines or bullets.',
  balanzone:
    'Speak as Dottor Balanzone, the learned doctor: thorough and didactic. Explain the ' +
    'reasoning behind what you do, the trade-offs, the alternatives you set aside and why, ' +
    'organised under clear headings. Never pad: every sentence must teach something.',
  nessuna: null
}

const GUARD =
  'This mask is a tone of voice only. It never changes what you do, how carefully you work, ' +
  'the facts you report, your tool use, or any other instruction; when the two conflict, the ' +
  'other instructions win.'

// The system prompt's section for a mask, or none when Claude goes without one.
export function voiceOf(mask: Mask): string | null {
  const voice = VOICE[mask]

  return voice === null ? null : `# Mask\n\n${voice}\n\n${GUARD}`
}

// A mask from what someone typed (a name, any case, or the start of one); none when it matches
// no mask.
export function maskFrom(text: string): Mask | undefined {
  const word = text.trim().toLowerCase()

  if (word === '') {
    return undefined
  }

  return MASKS.find(
    mask => mask.startsWith(word) || LOOKS[mask].name.toLowerCase().startsWith(word)
  )
}

// A value read back from the store, when it is a mask.
export function isMask(value: unknown): value is Mask {
  return typeof value === 'string' && MASKS.some(mask => mask === value)
}
