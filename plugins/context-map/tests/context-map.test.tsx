import { expect, test } from 'claude-code/testing'

import type { Segment } from '../types'
import { alertColor, allocateCells, formatTokens } from '../hooks/register'
import { VESUVIUS } from '../hooks/palette'

const SEGMENTS: Segment[] = [
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

test('formatTokens abbreviates thousands', async () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(84_400)).toBe('84k')
})

test('allocateCells fills the width exactly', async () => {
  const cells = allocateCells(SEGMENTS, 200_000, 40)
  expect(cells).toEqual([4, 12, 4, 20])
  expect(cells.reduce((a, b) => a + b, 0)).toBe(40)
})

test('a tiny segment still gets a cell, and the bar never overflows', async () => {
  const cells = allocateCells([{ name: 'Tools', tokens: 10, kind: 'used' }, ...SEGMENTS.slice(1)], 200_000, 40)
  expect(cells[0]).toBe(1)
  expect(cells.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(40)
})

test('the alert color rises as the window fills', async () => {
  expect(alertColor(30)).toBe(VESUVIUS.tuff)
  expect(alertColor(70)).toBe(VESUVIUS.magma)
  expect(alertColor(90)).toBe(VESUVIUS.lava)
})

test('the band shows the percentage and opens on details', async ($, on) => {
  // Beneath the mod, in place of Claude Code: a context window 40% full.
  on('session.usage', async () => ({ value: {
    startedAt: 0,
    rateLimits: [],
    context: {
      tokens: 80_000,
      window: 200_000,
      percent: 40,
      breakdown: {
        categories: SEGMENTS.map(s => ({ name: s.name, tokens: s.tokens, kind: s.kind, color: 'text', isDeferred: false })),
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
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-map', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '80k/200k' })).toBeDefined()

    await ui.press({ key: 'details' })
    expect(await ui.find({ type: 'Text', text: /Messages 60k · 30%/ })).toBeDefined()
    await ui.press({ key: 'details' })
    await ui.unmount()
  }
})
