import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { maskFrom, voiceOf } from '../hooks/masks'

const PANE_PROPS = {
  title: 'Maschere',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {}
}

// What a system prompt render carries, and what a typed command carries.
const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal' as const],
  tools: [],
  outputStyle: null,
  traits: []
}

const TYPED = {
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 }
}

const BASE = { id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }

test('maskFrom reads a name in any case, or the start of one', async () => {
  expect([
    maskFrom('Arlecchino'),
    maskFrom('bal'),
    maskFrom('senza'),
    maskFrom('zorro'),
    maskFrom(' ')
  ]).toEqual(['arlecchino', 'balanzone', 'nessuna', undefined, undefined])
})

test('a mask asks for a voice and keeps every other instruction first', async () => {
  expect(voiceOf('nessuna')).toBeNull()
  expect(voiceOf('arlecchino')).toMatch(/terse/)
  expect(voiceOf('pulcinella')).toMatch(/other instructions win/)
})

// A session whose system prompt is one shared section, with the mask remembered from before.
async function seed($: Engine, on: On, remembered?: string): Promise<void> {
  mock.store(on, remembered === undefined ? {} : { mask: remembered })
  on('session.start', async (_$, e) => e)
  on('ui.status', async () => ({ value: undefined }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('prompt.compose', async () => ({ sections: [BASE] }))
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
}

test('without a mask the system prompt is left as it is', async ($, on) => {
  await seed($, on)

  expect((await $.prompt.compose(COMPOSE)).sections).toEqual([BASE])
})

test('/maschera with a name puts the mask on and its voice goes last in the prompt', async ($, on) => {
  await seed($, on)
  const ran = await $.command.run({ command: 'maschera', args: 'arlecchino', ...TYPED })
  const sections = (await $.prompt.compose(COMPOSE)).sections

  expect(ran.text).toMatch(/Arlecchino/)
  expect(sections.map(s => [s.id, s.scope])).toEqual([
    ['intro', 'shared'],
    ['maschere:voice', 'session']
  ])
})

test('an unknown name leaves the mask as it was and says which ones exist', async ($, on) => {
  await seed($, on)
  const ran = await $.command.run({ command: 'maschera', args: 'zorro', ...TYPED })

  expect(ran.text).toMatch(/pulcinella, arlecchino, balanzone, nessuna/)
  expect((await $.prompt.compose(COMPOSE)).sections).toEqual([BASE])
})

test('a new session starts with the mask worn last', async ($, on) => {
  await seed($, on, 'balanzone')

  expect((await $.prompt.compose(COMPOSE)).sections.at(-1)?.text).toMatch(/Balanzone/)
})

test('the picker puts on the mask pressed and marks it worn', async ($, on) => {
  await seed($, on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'maschere',
      surface,
      component: 'Pane',
      requestId: 'maschere',
      props: PANE_PROPS
    })
    await ui.press({ key: 'mask-pulcinella' })
    expect(await ui.find({ type: 'Text', text: '● worn' })).toBeDefined()
    expect((await $.prompt.compose(COMPOSE)).sections.at(-1)?.text).toMatch(/Pulcinella/)
    await ui.unmount()
  }
})
