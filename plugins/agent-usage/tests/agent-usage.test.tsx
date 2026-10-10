import { expect, test } from 'claude-code/testing'

import { MAIN, addUsage, emptyUsage, formatDuration, formatTokens, shortModel, sorted, totalOf, upsert } from '../hooks/register'

const PANE_PROPS = {
  title: 'Agent usage',
  isFocused: true,
  bodyColumns: 100,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

const USAGE = { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 8_000, cache_creation_input_tokens: 500 }

test('addUsage sums tokens and counts requests', async () => {
  const a = addUsage(addUsage(emptyUsage('a1', 'Find the bug', 'Explore'), { ...USAGE, model: 'claude-sonnet-5' }), USAGE)
  expect(a.steps).toBe(2)
  expect(a.model).toBe('claude-sonnet-5')
  expect(totalOf(a)).toBe(20_000)
})

test('upsert creates a missing row and changes an existing one', async () => {
  let list = upsert([], 'a1', a => ({ ...a, tools: a.tools + 1 }), () => emptyUsage('a1', 'x', 'y'))
  list = upsert(list, 'a1', a => ({ ...a, tools: a.tools + 1 }), () => emptyUsage('a1', 'x', 'y'))
  expect(list).toHaveLength(1)
  expect(list[0]?.tools).toBe(2)
})

test('sorted puts the main conversation first, then the biggest subagents', async () => {
  const small = addUsage(emptyUsage('s', 'small', 'Explore'), USAGE)
  const big = addUsage(addUsage(emptyUsage('b', 'big', 'Plan'), USAGE), USAGE)
  const main = emptyUsage(MAIN, 'Main conversation', 'main')
  expect(sorted([small, main, big]).map(a => a.id)).toEqual([MAIN, 'b', 's'])
})

test('the formatters', async () => {
  expect(formatTokens(20_000)).toBe('20k')
  expect(formatTokens(1_500)).toBe('1.5k')
  expect(formatDuration(64_000)).toBe('1m 4s')
  expect(formatDuration(null)).toBe('—')
  expect(shortModel('claude-sonnet-5-20260601')).toBe('sonnet-5')
})

test('the pane shows each agent, its share, and its details on press', async ($, on) => {
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5', agentId: 'a1' }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { ...USAGE, model: e.model } }
  })
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  // One request in the main loop, a subagent that makes two requests and one tool call.
  const steps = [
    { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 },
    { turnId: 't2', index: 0, model: 'claude-sonnet-5', messageCount: 1, agentId: 'a1' },
    { turnId: 't2', index: 1, model: 'claude-sonnet-5', messageCount: 3, agentId: 'a1' },
  ]
  await $.agent.spawn({ tool_use_id: 'u1', prompt: 'Find where config is read.', description: 'Find config loading', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false })
  for (const step of steps) {
    for await (const _ of $.turn.step(step)) {
      // nothing streams here
    }
  }
  // A read made inside the subagent's loop (a variable, since agentId is the engine's field, not the tool's).
  const readInSubagent = { tool: 'Read' as const, tool_use_id: 'r1', file_path: '/project/config.ts', agentId: 'a1' }
  await $.tool.call(readInSubagent)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-usage', surface, component: 'Pane', requestId: 'agent-usage', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /1 subagent/ })).toBeDefined()
    expect((await ui.find({ key: `agent-${MAIN}` }))?.text).toMatch(/Main conversation\s+10k\s+33%/)
    expect((await ui.find({ key: 'agent-a1' }))?.text).toMatch(/Find config loading\s+20k\s+67%/)

    await ui.press({ key: 'agent-a1' })
    expect(await ui.find({ type: 'Text', text: /Explore · sonnet-5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 requests · 1 tool call/ })).toBeDefined()
    await ui.press({ key: 'agent-a1' })
    expect(await ui.find({ type: 'Text', text: /2 requests/ })).toBeUndefined()
    await ui.unmount()
  }
})
