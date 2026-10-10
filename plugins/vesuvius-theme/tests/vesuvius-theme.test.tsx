import { expect, test } from 'claude-code/testing'

import { durata, scegli } from '../hooks/register'
import { VESUVIUS } from '../hooks/vesuvius'

test('durata formatta secondi e minuti', async () => {
  expect(durata(3_200)).toBe('3s')
  expect(durata(64_000)).toBe('1m 4s')
})

test('scegli resta sempre dentro la lista', async () => {
  expect(scegli(['a', 'b', 'c'], 4)).toBe('b')
  expect(scegli(['a', 'b', 'c'], -1)).toBe('b')
})

test('lo spinner del terminale prende i colori della lava', async $ => {
  const ui = await $.ui.mount({
    plugin: 'vesuvius-theme',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
  })
  const parola = await ui.find({ type: 'Text', text: /…$/ })
  expect(parola?.props.color).toBe(VESUVIUS.magma)
  await ui.unmount()
})

test('un messaggio di stato vince sulla parola vulcanica', async $ => {
  const ui = await $.ui.mount({
    plugin: 'vesuvius-theme',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Sauteing', message: 'Compacting', suffix: '…', mode: 'thinking' },
  })
  expect(await ui.find({ type: 'Text', text: 'Compacting…' })).toBeDefined()
  await ui.unmount()
})

test('la riga di fine turno diventa un’eruzione', async $ => {
  const ui = await $.ui.mount({
    plugin: 'vesuvius-theme',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 64_000 },
  })
  expect(await ui.find({ type: 'Text', text: / per 1m 4s$/ })).toBeDefined()
  await ui.unmount()
})
