import { expect, test } from 'claude-code/testing'

import { formatDuration, pick } from '../hooks/register'
import { VESUVIUS } from '../hooks/palette'

test('formatDuration formats seconds and minutes', async () => {
  expect(formatDuration(3_200)).toBe('3s')
  expect(formatDuration(64_000)).toBe('1m 4s')
})

test('pick always stays inside the list', async () => {
  expect(pick(['a', 'b', 'c'], 4)).toBe('b')
  expect(pick(['a', 'b', 'c'], -1)).toBe('b')
})

test('the terminal spinner takes the lava colors', async $ => {
  const ui = await $.ui.mount({
    plugin: 'vesuvius-theme',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
  })
  const word = await ui.find({ type: 'Text', text: /…$/ })
  expect(word?.props.color).toBe(VESUVIUS.magma)
  await ui.unmount()
})

test('a status message wins over the volcanic word', async $ => {
  const ui = await $.ui.mount({
    plugin: 'vesuvius-theme',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Sauteing', message: 'Compacting', suffix: '…', mode: 'thinking' },
  })
  expect(await ui.find({ type: 'Text', text: 'Compacting…' })).toBeDefined()
  await ui.unmount()
})

test('the end-of-turn line becomes an eruption', async $ => {
  const ui = await $.ui.mount({
    plugin: 'vesuvius-theme',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 64_000 },
  })
  expect(await ui.find({ type: 'Text', text: / for 1m 4s$/ })).toBeDefined()
  await ui.unmount()
})
