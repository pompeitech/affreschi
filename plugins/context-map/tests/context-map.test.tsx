import { expect, test } from 'claude-code/testing'
import type { SessionContextBreakdown } from 'claude-code'

import type { Segment } from '../types'
import { alertColor, allocateCells, formatTokens, percentOf, shortPath, toContextMap } from '../hooks/register'
import { VESUVIUS } from '../hooks/palette'

const SEGMENTS: Segment[] = [
  { name: 'System prompt', tokens: 20_000, kind: 'used' },
  { name: 'Messages', tokens: 60_000, kind: 'used' },
  { name: 'Autocompact buffer', tokens: 20_000, kind: 'buffer' },
  { name: 'Free space', tokens: 100_000, kind: 'free' },
]

const BREAKDOWN: SessionContextBreakdown = {
  categories: SEGMENTS.map(s => ({ name: s.name, tokens: s.tokens, kind: s.kind, color: 'text', isDeferred: false })),
  totalTokens: 80_000,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'auto',
  percentage: 40,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [
    { path: '/Users/me/.claude/CLAUDE.md', type: 'User', tokens: 1_200 },
    { path: '/Users/me/projects/app/CLAUDE.md', type: 'Project', tokens: 3_400 },
  ],
  mcpTools: [
    { name: 'mcp__linear__create_issue', serverName: 'linear', tokens: 800, isLoaded: true },
    { name: 'mcp__linear__list_issues', serverName: 'linear', tokens: 700, isLoaded: false },
  ],
  agents: [{ agentType: 'architect', source: 'userSettings', tokens: 500 }],
  skills: { totalSkills: 1, includedSkills: 1, tokens: 90, skillFrontmatter: [{ name: 'pdf', source: 'built-in', tokens: 90 }] },
  autoCompactThreshold: 167_000,
  isAutoCompactEnabled: true,
  apiUsage: null,
}

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const PANE_PROPS = {
  title: 'Context map',
  isFocused: true,
  bodyColumns: 90,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test('formatTokens abbreviates thousands and millions', async () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(3_400)).toBe('3.4k')
  expect(formatTokens(84_400)).toBe('84k')
  expect(formatTokens(1_000_000)).toBe('1.0M')
})

test('percentOf never shows a tiny share as 0%', async () => {
  expect(percentOf(60_000, 200_000)).toBe('30%')
  expect(percentOf(90, 200_000)).toBe('<1%')
})

test('shortPath keeps the last two parts', async () => {
  expect(shortPath('/Users/me/.claude/CLAUDE.md')).toBe('.claude/CLAUDE.md')
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

test('toContextMap groups MCP tools by server and sorts details by size', async () => {
  const m = toContextMap(BREAKDOWN)
  expect(m.mcpServers).toEqual([{ name: 'linear', note: '1/2 tools loaded', tokens: 1_500 }])
  expect(m.memoryFiles.map(f => f.name)).toEqual(['app/CLAUDE.md', '.claude/CLAUDE.md'])
  expect(m.autoCompactThreshold).toBe(167_000)
})

test('the band shows the bar, the legend, and hides the legend on request', async ($, on) => {
  on('session.usage', async () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 80_000, window: 200_000, percent: 40, breakdown: BREAKDOWN } } }))
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-map', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '80k/200k' })).toBeDefined()

    // The legend is there from the start, one entry per category.
    expect(await ui.find({ type: 'Text', text: /Messages 60k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Free space 100k/ })).toBeDefined()

    await ui.press({ key: 'legend' })
    expect(await ui.find({ type: 'Text', text: /Messages 60k/ })).toBeUndefined()
    await ui.press({ key: 'legend' })
    expect(await ui.find({ type: 'Text', text: /Messages 60k/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane lists every category and the detail sections', async ($, on) => {
  on('session.usage', async () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 80_000, window: 200_000, percent: 40, breakdown: BREAKDOWN } } }))
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-map', surface, component: 'Pane', requestId: 'context-map', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /compacts at 167k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Messages\s+60k\s+30%/ })).toBeDefined()
    for (const title of ['Memory files', 'MCP servers', 'Custom agents', 'Skills']) {
      expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /linear 1\/2 tools loaded 1\.5k/ })).toBeDefined()
    await ui.unmount()
  }
})
