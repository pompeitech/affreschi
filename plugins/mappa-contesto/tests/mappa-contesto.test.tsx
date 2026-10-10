import { expect, test } from 'claude-code/testing'

import type { Segmento } from '../types'
import { allerta, celle, k } from '../hooks/register'
import { VESUVIUS } from '../hooks/vesuvius'

const SEGMENTI: Segmento[] = [
  { name: 'System prompt', tokens: 20_000, kind: 'used' },
  { name: 'Messages', tokens: 60_000, kind: 'used' },
  { name: 'Autocompact buffer', tokens: 20_000, kind: 'buffer' },
  { name: 'Free space', tokens: 100_000, kind: 'free' },
]

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

test('k abbrevia le migliaia', async () => {
  expect(k(950)).toBe('950')
  expect(k(84_400)).toBe('84k')
})

test('celle riempie esattamente la larghezza', async () => {
  const quote = celle(SEGMENTI, 200_000, 40)
  expect(quote).toEqual([4, 12, 4, 20])
  expect(quote.reduce((a, b) => a + b, 0)).toBe(40)
})

test('un segmento piccolo ha comunque una cella, e la barra non sfora', async () => {
  const quote = celle([{ name: 'Tools', tokens: 10, kind: 'used' }, ...SEGMENTI.slice(1)], 200_000, 40)
  expect(quote[0]).toBe(1)
  expect(quote.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(40)
})

test('il colore di allerta sale con il riempimento', async () => {
  expect(allerta(30)).toBe(VESUVIUS.tufo)
  expect(allerta(70)).toBe(VESUVIUS.magma)
  expect(allerta(90)).toBe(VESUVIUS.lava)
})

test('la banda mostra la percentuale e si apre sui dettagli', async ($, on) => {
  // Sotto la mod, al posto di Claude Code: un contesto pieno al 40%.
  on('session.usage', async () => ({ value: {
    startedAt: 0,
    rateLimits: [],
    context: {
      tokens: 80_000,
      window: 200_000,
      percent: 40,
      breakdown: {
        categories: SEGMENTI.map(s => ({ name: s.name, tokens: s.tokens, kind: s.kind, color: 'text', isDeferred: false })),
        totalTokens: 80_000,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        autocompactSource: 'auto',
        percentage: 40,
        gridRows: [],
        model: 'claude-opus-5-5',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
        isAutoCompactEnabled: true,
        apiUsage: null,
      },
    },
  } }))
  on('session.start', async (_$, e) => e)
  await $.session.start({ cwd: '/progetto', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mappa-contesto', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '80k/200k' })).toBeDefined()

    await ui.press({ key: 'dettagli' })
    expect(await ui.find({ type: 'Text', text: /Messages 60k · 30%/ })).toBeDefined()
    await ui.press({ key: 'dettagli' })
    await ui.unmount()
  }
})
