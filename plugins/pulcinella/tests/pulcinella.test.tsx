import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { hatOf, labelOf, levelOf, linesOf, poseOf, QUOTES, quoteFor } from '../hooks/mascot'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {}
}

const USAGE = {
  input_tokens: 1_000,
  output_tokens: 500,
  cache_read_input_tokens: 8_000,
  cache_creation_input_tokens: 500
}

test('his level rises with the tokens spent', async () => {
  expect([levelOf(0), levelOf(1_500_000), levelOf(300_000_000)]).toEqual([1, 2, 5])
})

test('his hat grows a row per level, every row eight cells wide', async () => {
  expect([1, 2, 3, 4, 5].map(level => hatOf(level).map(row => row.length))).toEqual([
    [8],
    [8, 8],
    [8, 8, 8],
    [8, 8, 8, 8],
    [8, 8, 8, 8, 8]
  ])
})

test('he moves: two frames per mood, and a blink now and then while idle', async () => {
  expect(poseOf('working', 0).eyes).not.toBe(poseOf('working', 1).eyes)
  expect(poseOf('working', 1).lean).toBe(1)
  expect([poseOf('sleeping', 0).emote, poseOf('sleeping', 1).emote]).toEqual(['z', 'Z'])
  expect([poseOf('idle', 0).eyes, poseOf('idle', 11).eyes]).toEqual(['••', '──'])
})

test('a quote names what the moment is about', async () => {
  expect(quoteFor('worried', 'npm test', 0)).toBe('Mannaggia… npm test è caduto.')
  expect(QUOTES.happy).toContain(quoteFor('happy'))
})

test('labelOf names the command a Bash call ran, or the tool', async () => {
  expect(labelOf('Bash', 'npm run test -- --watch=false')).toBe('npm run test')
  expect(labelOf('Edit', undefined)).toBe('Edit')
})

test('linesOf counts the lines of a text', async () => {
  expect([linesOf(''), linesOf('a\nb\nc')]).toEqual([0, 3])
})

// Any of his happy lines, as a pattern a rendered Text can match.
const HAPPY = new RegExp(QUOTES.happy.map(q => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'))

// A session with nothing else in the band, where `npm run build` fails and every other command
// passes, every model request costs 10k tokens, and the store holds `spent` tokens from before.
async function seed($: Engine, on: On, spent = 0): Promise<void> {
  mock.clock(on)
  mock.store(on, { tokens: spent })
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  on('tool.call', async (_$, e) =>
    e.tool === 'Bash' && e.command === 'npm run build'
      ? { result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true, text: 'boom' }
      : { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }
  )
  // biome-ignore lint/correctness/useYield: the engine's stand-in answers the step without streaming
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { ...USAGE, model: e.model }
    }
  })
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
}

test('he frets over a failed command and names it', async ($, on) => {
  await seed($, on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'pulcinella',
      surface,
      component: 'AbovePrompt',
      props: BAND_PROPS
    })
    await $.tool.call({ tool: 'Bash', tool_use_id: `b1-${surface}`, command: 'npm run build' })
    expect(await ui.find({ type: 'Text', text: /npm run build/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' °° ' })).toBeDefined()
    await ui.unmount()
  }
})

test('he cheers when a test command passes', async ($, on) => {
  await seed($, on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'pulcinella',
      surface,
      component: 'AbovePrompt',
      props: BAND_PROPS
    })
    await $.tool.call({ tool: 'Bash', tool_use_id: `b2-${surface}`, command: 'npm test' })
    expect(await ui.find({ type: 'Text', text: ' ^^ ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: HAPPY })).toBeDefined()
    await ui.unmount()
  }
})

test('his hat grows a level once the tokens spent pass a million', async ($, on) => {
  await seed($, on, 995_000)
  const ui = await $.ui.mount({
    plugin: 'pulcinella',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS
  })
  expect(await ui.find({ type: 'Text', text: 'livello 1' })).toBeDefined()

  for await (const _ of $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'claude-opus-5-5',
    messageCount: 1
  })) {
    // nothing streams here
  }

  expect(await ui.find({ type: 'Text', text: 'livello 2' })).toBeDefined()
  await ui.unmount()
})

test('he naps after ten quiet minutes and wakes at the next prompt', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('prompt.submit', async (_$, e) => e)
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'pulcinella',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS
  })

  await clock.advance(9 * 60 * 1000)
  expect(await ui.find({ type: 'Text', text: ' •• ' })).toBeDefined()
  await clock.advance(2 * 60 * 1000)
  expect(await ui.find({ type: 'Text', text: ' ── ' })).toBeDefined()
  await $.prompt.submit({ text: 'sveglia', wait: false, origin: { kind: 'composer' } })
  expect(await ui.find({ type: 'Text', text: ' •• ' })).toBeDefined()
  await ui.unmount()
})

test('he stands beside a band a plugin beneath draws', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>context band</Text>
  })
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'pulcinella',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: BAND_PROPS
  })
  expect(await ui.find({ type: 'Text', text: 'context band' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'livello 1' })).toBeDefined()
  await ui.unmount()
})
