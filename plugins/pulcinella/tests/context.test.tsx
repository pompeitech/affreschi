import type { SessionContextBreakdown } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import {
  alertColor,
  allocateCells,
  formatTokens,
  headroomColor,
  headroomOf,
  percentOf,
  pushTotal,
  shortPath,
  toContextMap,
  turnsLeft
} from '../hooks/context'
import { VESUVIUS } from '../hooks/palette'
import type { Segment } from '../types'

const SEGMENTS: Segment[] = [
  { name: 'System prompt', tokens: 20_000, kind: 'used' },
  { name: 'Messages', tokens: 60_000, kind: 'used' },
  { name: 'Autocompact buffer', tokens: 20_000, kind: 'buffer' },
  { name: 'Free space', tokens: 100_000, kind: 'free' }
]

const BREAKDOWN: SessionContextBreakdown = {
  categories: SEGMENTS.map(s => ({
    name: s.name,
    tokens: s.tokens,
    kind: s.kind,
    color: 'text',
    isDeferred: false
  })),
  totalTokens: 80_000,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'auto',
  percentage: 40,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [
    { path: '/Users/me/.claude/CLAUDE.md', type: 'User', tokens: 1_200 },
    { path: '/Users/me/projects/app/CLAUDE.md', type: 'Project', tokens: 3_400 }
  ],
  mcpTools: [
    { name: 'mcp__linear__create_issue', serverName: 'linear', tokens: 800, isLoaded: true },
    { name: 'mcp__linear__list_issues', serverName: 'linear', tokens: 700, isLoaded: false }
  ],
  agents: [{ agentType: 'architect', source: 'userSettings', tokens: 500 }],
  skills: {
    totalSkills: 1,
    includedSkills: 1,
    tokens: 90,
    skillFrontmatter: [{ name: 'pdf', source: 'built-in', tokens: 90 }]
  },
  autoCompactThreshold: 167_000,
  isAutoCompactEnabled: true,
  apiUsage: null
}

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {}
}

const PANE_PROPS = {
  title: 'Context map',
  isFocused: true,
  bodyColumns: 90,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {}
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
  const cells = allocateCells(
    [{ name: 'Tools', tokens: 10, kind: 'used' }, ...SEGMENTS.slice(1)],
    200_000,
    40
  )
  expect(cells[0]).toBe(1)
  expect(cells.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(40)
})

test('the alert color rises as the window fills', async () => {
  expect(alertColor(30)).toBe(VESUVIUS.tuff)
  expect(alertColor(70)).toBe(VESUVIUS.magma)
  expect(alertColor(90)).toBe(VESUVIUS.lava)
})

test('the headroom runs to the compaction threshold, or to the window when there is none', async () => {
  const m = toContextMap(BREAKDOWN)
  expect(headroomOf(m)).toBe(87_000)
  expect(headroomOf({ ...m, autoCompactThreshold: null })).toBe(120_000)
  expect(headroomColor(m)).toBe(VESUVIUS.vineyard)
  expect(headroomColor({ ...m, total: 150_000 })).toBe(VESUVIUS.lava)
})

test('the pace estimate averages recent growth and starts over after a compaction', async () => {
  expect(turnsLeft([80_000], 87_000)).toBeNull()
  expect(turnsLeft([60_000, 70_000, 80_000], 87_000)).toBe(8)
  expect(turnsLeft([80_000, 80_000], 87_000)).toBeNull()
  expect(pushTotal([60_000, 80_000], 30_000)).toEqual([30_000])
  expect(pushTotal([1, 2, 3, 4, 5, 6], 7)).toEqual([2, 3, 4, 5, 6, 7])
})

test('toContextMap groups MCP tools by server and sorts details by size', async () => {
  const m = toContextMap(BREAKDOWN)
  expect(m.mcpServers).toEqual([{ name: 'linear', note: '1/2 tools loaded', tokens: 1_500 }])
  expect(m.memoryFiles.map(f => f.name)).toEqual(['app/CLAUDE.md', '.claude/CLAUDE.md'])
  expect(m.autoCompactThreshold).toBe(167_000)
})

test('the band shows used and headroom, the chips, and hides them on request', async ($, on) => {
  // Nothing else draws in the band.
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  mock.clock(on)
  mock.store(on)
  on('session.usage', async () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: { tokens: 80_000, window: 200_000, percent: 40, breakdown: BREAKDOWN }
    }
  }))
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'pulcinella',
      surface,
      component: 'AbovePrompt',
      props: BAND_PROPS
    })
    expect(await ui.find({ type: 'Text', text: /200k · 40%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'before compaction' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '87k' })).toBeDefined()
    // No estimate before two turns have ended.
    expect(await ui.find({ type: 'Text', text: /turns at the current pace/ })).toBeUndefined()

    // The chips are there from the start: used categories only, largest first.
    expect(await ui.find({ type: 'Text', text: /messages 60k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /system prompt 20k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /free space/ })).toBeUndefined()

    await ui.press({ key: 'legend' })
    expect(await ui.find({ type: 'Text', text: /messages 60k/ })).toBeUndefined()
    await ui.press({ key: 'legend' })
    expect(await ui.find({ type: 'Text', text: /messages 60k/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the band keeps what a plugin beneath draws, under its own', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', async () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: { tokens: 80_000, window: 200_000, percent: 40, breakdown: BREAKDOWN }
    }
  }))
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>pulcinella</Text>
  })
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'pulcinella',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: BAND_PROPS
  })
  expect(await ui.find({ type: 'Text', text: 'pulcinella' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'before compaction' })).toBeDefined()
  await ui.unmount()
})

test('the pane lists every category and the detail sections', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', async () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: { tokens: 80_000, window: 200_000, percent: 40, breakdown: BREAKDOWN }
    }
  }))
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'pulcinella',
      surface,
      component: 'Pane',
      requestId: 'context-map',
      props: PANE_PROPS
    })
    expect(await ui.find({ type: 'Text', text: /compacts at 167k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Messages\s+60k\s+30%/ })).toBeDefined()

    expect(await ui.find({ type: 'Text', text: 'Memory files' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'MCP servers' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Custom agents' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Skills' })).toBeDefined()

    expect(await ui.find({ type: 'Text', text: /linear 1\/2 tools loaded 1\.5k/ })).toBeDefined()
    await ui.unmount()
  }
})
