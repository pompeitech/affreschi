import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { Mask } from '../types'
import { isMask, LOOKS, MASKS, maskFrom, voiceOf } from './masks'
import { VESUVIUS } from './palette'

const PANE = 'maschere'
const MASK_KEY = 'mask'
const MASK_BLACK = '#1A1A1A'
const WHITE = '#F2EFE9'

const NO_MASK: Mask = 'nessuna'
const mask = atom({ plugin: 'maschere', key: 'mask' } as const, NO_MASK)

// Puts a mask on: for this session and as the one the next session starts with, shown in the
// status line while one is worn.
async function wear($: EngineInterface, next: Mask): Promise<void> {
  await update($, mask, () => next)
  await $.store.set(MASK_KEY, next)
  $.ui.status(next === 'nessuna' ? undefined : `◐ ${LOOKS[next].name}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'maschera',
      description: 'Choose the mask Claude answers with: pulcinella, arlecchino, balanzone or none',
      argumentHint: '[pulcinella|arlecchino|balanzone|nessuna]'
    })
    const stored = await $.store.get(MASK_KEY)

    if (isMask(stored)) {
      await update($, mask, () => stored)
      $.ui.status(stored === 'nessuna' ? undefined : `◐ ${LOOKS[stored].name}`)
    }

    return next(e)
  })

  // `/maschera arlecchino` puts it on at once; `/maschera` alone opens the picker.
  on('command.run', { command: 'maschera' }, async ($, e) => {
    if (e.args.trim() === '') {
      await $.ui.open({ id: PANE, title: 'Maschere', focus: true, closeOnEscape: true })

      return {}
    }

    const chosen = maskFrom(e.args)

    if (chosen === undefined) {
      return { text: `No mask called "${e.args.trim()}". Try: ${MASKS.join(', ')}.` }
    }

    await wear($, chosen)

    return {
      text:
        chosen === 'nessuna'
          ? 'Mask off: Claude answers as itself.'
          : `Claude now wears ${LOOKS[chosen].name}: ${LOOKS[chosen].says}.`
    }
  })

  // The worn mask's voice goes last in the system prompt, on the session side of the cache.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const voice = voiceOf(await read($, mask))

    if (voice === null) {
      return result
    }

    return {
      sections: [...result.sections, { id: 'maschere:voice', text: voice, scope: 'session' }]
    }
  })

  // The picker: every mask with its face and its voice, the worn one marked.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const worn = await read($, mask)

    return (
      <Box flexDirection="column" rowGap={1}>
        <Text>
          <Text color={VESUVIUS.lava}>◆</Text> <Text bold>maschera</Text>
          <Text color={VESUVIUS.ash}> · the voice changes, the work does not</Text>
        </Text>
        {MASKS.map(m => {
          const look = LOOKS[m]
          const isWorn = m === worn

          return (
            <Box flexDirection="row" columnGap={2} alignItems="center">
              {/* Monospaced, so the glyphs line up where the surface's font is proportional. */}
              <Box flexDirection="column" flexShrink={0}>
                <Text mono color={look.color}>
                  {look.hat}
                </Text>
                <Text mono color={look.color}>
                  {' ▐'}
                  <Text backgroundColor={MASK_BLACK} color={WHITE}>
                    {look.eyes}
                  </Text>
                  {'▌ '}
                </Text>
              </Box>
              <Box flexDirection="column" flexGrow={1}>
                <Button key={`mask-${m}`} plain label={look.name} onPress={() => wear($, m)} />
                <Text color={VESUVIUS.ash}>{look.says}</Text>
              </Box>
              <Text color={isWorn ? VESUVIUS.lava : VESUVIUS.ash}>{isWorn ? '● worn' : ''}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
