import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'
import { ROLE_NAME, roleOf, SPRITE_WIDTH, spriteOf } from '../hooks/cast'
import {
  addUsage,
  completedAgentOf,
  emptyUsage,
  formatDuration,
  formatTokens,
  MAIN,
  mergeKnown,
  shortModel,
  sorted,
  totalOf,
  upsert
} from '../hooks/register'
import type { AgentUsage, Role } from '../types'

const PANE_PROPS = {
  title: 'Agent usage',
  isFocused: true,
  bodyColumns: 100,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {}
}

const USAGE = {
  input_tokens: 1_000,
  output_tokens: 500,
  cache_read_input_tokens: 8_000,
  cache_creation_input_tokens: 500
}

test('addUsage sums tokens and counts requests', async () => {
  const a = addUsage(
    addUsage(emptyUsage('a1', 'Find the bug', 'Explore'), { ...USAGE, model: 'claude-sonnet-5' }),
    USAGE
  )
  expect(a.steps).toBe(2)
  expect(a.model).toBe('claude-sonnet-5')
  expect(totalOf(a)).toBe(20_000)
})

test('upsert creates a missing row and changes an existing one', async () => {
  let list = upsert(
    [],
    'a1',
    a => ({ ...a, tools: a.tools + 1 }),
    () => emptyUsage('a1', 'x', 'y')
  )
  list = upsert(
    list,
    'a1',
    a => ({ ...a, tools: a.tools + 1 }),
    () => emptyUsage('a1', 'x', 'y')
  )
  expect(list).toHaveLength(1)
  expect(list[0]?.tools).toBe(2)
})

test('sorted puts the main conversation first, then the biggest subagents', async () => {
  const small = addUsage(emptyUsage('s', 'small', 'Explore'), USAGE)
  const big = addUsage(addUsage(emptyUsage('b', 'big', 'Plan'), USAGE), USAGE)
  const main = emptyUsage(MAIN, 'Main conversation', 'main')
  expect(sorted([small, main, big]).map(a => a.id)).toEqual([MAIN, 'b', 's'])
})

test('mergeKnown updates statuses and adds the agents the hooks never saw', async () => {
  const seen = emptyUsage('a1', 'Find config loading', 'Explore')
  const merged = mergeKnown(
    [seen],
    [
      { id: 'a1', description: 'Find config loading', type: 'Explore', status: 'completed' },
      {
        id: 'r@team',
        teammateId: 'reviewer@team',
        description: '',
        type: 'code-reviewer',
        status: 'running'
      }
    ]
  )
  expect(merged.map(a => [a.id, a.status])).toEqual([
    ['a1', 'completed'],
    ['r@team', 'running']
  ])
  expect(merged[1]?.label).toBe('reviewer@team')
  expect(merged[1]?.type).toBe('code-reviewer')
})

test('formatTokens abbreviates thousands', async () => {
  expect([formatTokens(950), formatTokens(1_500), formatTokens(20_000)]).toEqual([
    '950',
    '1.5k',
    '20k'
  ])
})

test('formatDuration shows minutes and seconds, and a dash before the agent ends', async () => {
  expect([formatDuration(64_000), formatDuration(null)]).toEqual(['1m 4s', '—'])
})

test('shortModel drops the claude- prefix and the date', async () => {
  expect(shortModel('claude-sonnet-5-20260601')).toBe('sonnet-5')
})

test('roleOf casts an agent from its type, then from its name', async () => {
  const cast = (type: string, label = '') => roleOf({ id: 'x', type, label }, MAIN)

  expect([
    cast('Explore'),
    cast('Plan'),
    cast('code-reviewer'),
    cast('security-reviewer'),
    cast('qa-tester'),
    cast('frontend-dev'),
    cast('general-purpose'),
    cast('general-purpose', 'Redesign the settings UI'),
    roleOf({ id: MAIN, type: 'main', label: 'Main conversation' }, MAIN)
  ]).toEqual([
    'explorer',
    'nerd',
    'reviewer',
    'guard',
    'tester',
    'artist',
    'handyman',
    'artist',
    'pulcinella'
  ])
})

test('every character is four rows of the same width, in every status', async () => {
  const roles: Role[] = [
    'pulcinella',
    'artist',
    'nerd',
    'explorer',
    'reviewer',
    'guard',
    'tester',
    'handyman'
  ]
  const statuses: AgentUsage['status'][] = ['running', 'completed', 'failed', 'idle']
  const widths = roles.flatMap(role =>
    statuses.map(status =>
      spriteOf(role, status).map(row => row.reduce((sum, run) => sum + [...run.text].length, 0))
    )
  )

  expect(new Set(widths.map(rows => rows.join(',')))).toEqual(
    new Set([[SPRITE_WIDTH, SPRITE_WIDTH, SPRITE_WIDTH, SPRITE_WIDTH].join(',')])
  )
})

test('the eyes follow the status', async () => {
  const faces = (['running', 'completed', 'failed', 'idle'] as const).map(
    status =>
      spriteOf('explorer', status)[1]
        ?.map(run => run.text)
        .join('') ?? ''
  )

  expect(new Set(faces).size).toBe(4)
})

test('completedAgentOf reads a completed Agent call and ignores anything else', async () => {
  expect(completedAgentOf({ status: 'completed', agentId: 'a1', totalDurationMs: 64_000 })).toEqual(
    {
      agentId: 'a1',
      totalDurationMs: 64_000
    }
  )
  expect(completedAgentOf({ status: 'completed', agentId: 'a1', totalDurationMs: '1m' })).toEqual({
    agentId: 'a1',
    totalDurationMs: null
  })
  expect([
    completedAgentOf('ok'),
    completedAgentOf(null),
    completedAgentOf({ status: 'async_launched', agentId: 'a1' }),
    completedAgentOf({ status: 'completed', agentId: 7 })
  ]).toEqual([undefined, undefined, undefined, undefined])
})

// A session where the main loop made one request and the subagent a1 ("Find config loading",
// an Explore agent) made two requests and one Read; `agentResult` is what an Agent call answers.
async function seed($: Engine, on: On, agentResult: unknown = 'ok'): Promise<void> {
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('prompt.submit', async (_$, e) => e)
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5', agentId: 'a1' }))
  on('tool.call', async (_$, e) => ({ result: e.tool === 'Agent' ? agentResult : 'ok' }))
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
  await $.agent.spawn({
    tool_use_id: 'u1',
    prompt: 'Find where config is read.',
    description: 'Find config loading',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false
  })

  const steps = [
    { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 },
    { turnId: 't2', index: 0, model: 'claude-sonnet-5', messageCount: 1, agentId: 'a1' },
    { turnId: 't2', index: 1, model: 'claude-sonnet-5', messageCount: 3, agentId: 'a1' }
  ]

  for (const step of steps) {
    for await (const _ of $.turn.step(step)) {
      // nothing streams here
    }
  }

  // A read made inside the subagent's loop (a variable, since agentId is the engine's field, not the tool's).
  const readInSubagent = {
    tool: 'Read' as const,
    tool_use_id: 'r1',
    file_path: '/project/config.ts',
    agentId: 'a1'
  }

  await $.tool.call(readInSubagent)
}

test('the pane shows each agent with its mascot, model, share and counts', async ($, on) => {
  await seed($, on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-usage',
      surface,
      component: 'Pane',
      requestId: 'agent-usage',
      props: PANE_PROPS
    })
    expect(await ui.find({ type: 'Text', text: /30k tokens · 3 requests/ })).toBeDefined()
    // The Explore agent plays the explorer: a lamp on the head, eyes open while it works.
    expect(await ui.find({ type: 'Text', text: /◉▄▄▄/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeDefined()
    expect((await ui.find({ key: `agent-${MAIN}` }))?.text).toBe('Main conversation')
    expect((await ui.find({ key: 'agent-a1' }))?.text).toBe('Find config loading')
    expect(await ui.find({ type: 'Text', text: 'sonnet-5 · Explore' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /20k 67%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2 requests · 1 tool call$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pressing an agent shows its token details, pressing again hides them', async ($, on) => {
  await seed($, on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-usage',
      surface,
      component: 'Pane',
      requestId: 'agent-usage',
      props: PANE_PROPS
    })
    await ui.press({ key: 'agent-a1' })
    expect(await ui.find({ type: 'Text', text: 'CACHE READ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '16k' })).toBeDefined()
    await ui.press({ key: 'agent-a1' })
    expect(await ui.find({ type: 'Text', text: 'CACHE READ' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a completed Agent call marks its agent done and records how long it ran', async ($, on) => {
  await seed($, on, { status: 'completed', agentId: 'a1', totalDurationMs: 64_000 })
  await $.tool.call({
    tool: 'Agent',
    tool_use_id: 'u1',
    description: 'Find config loading',
    prompt: 'Find where config is read.',
    subagent_type: 'Explore'
  })

  const ui = await $.ui.mount({
    plugin: 'agent-usage',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'agent-usage',
    props: PANE_PROPS
  })
  expect(await ui.find({ type: 'Text', text: /done/ })).toBeDefined()
  await ui.press({ key: 'agent-a1' })
  expect(await ui.find({ type: 'Text', text: '1m 4s' })).toBeDefined()
  await ui.unmount()
})

test('a finished agent moves to the archive at the next prompt, grouped by role', async ($, on) => {
  await seed($, on, { status: 'completed', agentId: 'a1', totalDurationMs: 64_000 })
  await $.tool.call({
    tool: 'Agent',
    tool_use_id: 'u1',
    description: 'Find config loading',
    prompt: 'Find where config is read.',
    subagent_type: 'Explore'
  })
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })

  const ui = await $.ui.mount({
    plugin: 'agent-usage',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'agent-usage',
    props: PANE_PROPS
  })
  expect(await ui.find({ key: 'agent-a1' })).toBeUndefined()
  expect((await ui.find({ key: 'group-explorer' }))?.text).toBe(`${ROLE_NAME.explorer[0]} ×1`)

  await ui.press({ key: 'group-explorer' })
  expect(await ui.find({ type: 'Text', text: /Find config loading/ })).toBeDefined()
  await ui.unmount()
})

test('clearing the archive takes its agents off the list and keeps them in the totals', async ($, on) => {
  await seed($, on, { status: 'completed', agentId: 'a1', totalDurationMs: 64_000 })
  await $.tool.call({
    tool: 'Agent',
    tool_use_id: 'u1',
    description: 'Find config loading',
    prompt: 'Find where config is read.',
    subagent_type: 'Explore'
  })
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })

  const ui = await $.ui.mount({
    plugin: 'agent-usage',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'agent-usage',
    props: PANE_PROPS
  })
  await ui.press({ key: 'clear' })
  expect(await ui.find({ key: 'group-explorer' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /30k tokens · 3 requests/ })).toBeDefined()
  await ui.unmount()
})
