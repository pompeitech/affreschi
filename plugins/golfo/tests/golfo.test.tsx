import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { dayKey, daysFrom, lastWeek, markOf, projectsOf, record, sumOf } from '../hooks/ledger'

const PANE_PROPS = {
  title: 'Il Golfo',
  isFocused: true,
  bodyColumns: 90,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {}
}

// Saturday 25 October 2026, at noon.
const NOON = new Date(2026, 9, 25, 12).getTime()
const DAY_MS = 24 * 60 * 60 * 1000

test('record adds a turn to its day under its project', async () => {
  const once = record({}, NOON, { usd: 1.5, tokens: 1000, project: 'affreschi' })
  const twice = record(once, NOON, { usd: 0.5, tokens: 500, project: '7hub' })

  expect(twice[dayKey(NOON)]).toEqual({
    usd: 2,
    tokens: 1500,
    projects: { affreschi: 1.5, '7hub': 0.5 }
  })
})

test('record drops days older than ninety', async () => {
  const old = record({}, NOON - 100 * DAY_MS, { usd: 1, tokens: 1, project: 'p' })
  const now = record(old, NOON, { usd: 1, tokens: 1, project: 'p' })

  expect(Object.keys(now)).toEqual([dayKey(NOON)])
})

test('the last week holds seven days ending today, empty days included', async () => {
  const days = record({}, NOON - DAY_MS, { usd: 3, tokens: 10, project: 'p' })
  const week = lastWeek(days, NOON)

  expect(week.map(w => w.day.usd)).toEqual([0, 0, 0, 0, 0, 3, 0])
  expect(sumOf(week)).toEqual({ usd: 3, tokens: 10 })
})

test('projectsOf ranks the projects by what they cost in the week', async () => {
  const days = record(record({}, NOON, { usd: 1, tokens: 0, project: 'a' }), NOON - DAY_MS, {
    usd: 4,
    tokens: 0,
    project: 'b'
  })

  expect(projectsOf(lastWeek(days, NOON))).toEqual([
    ['b', 4],
    ['a', 1]
  ])
})

test('markOf reaches 80 and 100, and stays quiet with no budget', async () => {
  expect([markOf(10, 25), markOf(20, 25), markOf(30, 25), markOf(30, 0)]).toEqual([0, 80, 100, 0])
})

test('daysFrom keeps only entries shaped like a day', async () => {
  expect(
    daysFrom({ '2026-10-25': { usd: 1, tokens: 2, projects: { a: 1, b: 'x' } }, bad: 3 })
  ).toEqual({
    '2026-10-25': { usd: 1, tokens: 2, projects: { a: 1 } }
  })
  expect(daysFrom('nope')).toEqual({})
})

// A session in /work/affreschi at NOON whose cost grows to each value of `costs` in turn, every
// model request using 10k tokens; `toasts` collects what the mod announces.
async function seed($: Engine, on: On, costs: number[], toasts: string[]): Promise<void> {
  mock.clock(on, { now: NOON })
  mock.store(on)
  let reads = 0
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('session.usage', async () => {
    const usd = costs[Math.min(reads, costs.length - 1)] ?? 0
    reads += 1

    return {
      value: {
        startedAt: 0,
        rateLimits: [],
        context: { tokens: 0, window: 200_000, percent: 0 },
        cost: { usd }
      }
    }
  })
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  // biome-ignore lint/correctness/useYield: the engine's stand-in answers the step without streaming
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        input_tokens: 2_000,
        output_tokens: 1_000,
        cache_read_input_tokens: 6_000,
        cache_creation_input_tokens: 1_000,
        model: e.model
      }
    }
  })
  await $.session.start({ cwd: '/work/affreschi', surface: 'terminal', isInteractive: true })
}

async function oneTurn($: Engine, id: string): Promise<void> {
  for await (const _ of $.turn.step({
    turnId: id,
    index: 0,
    model: 'claude-opus-5-5',
    messageCount: 1
  })) {
    // nothing streams here
  }

  await $.turn.complete({
    turnId: id,
    answer: '',
    durationMs: 1_000,
    isAborted: false,
    reason: 'answer'
  })
}

test('each turn adds to today only what the session cost since the last one', async ($, on) => {
  await seed($, on, [0, 1.25, 3], [])
  await oneTurn($, 't1')
  await oneTurn($, 't2')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'golfo',
      surface,
      component: 'Pane',
      requestId: 'golfo',
      props: PANE_PROPS
    })
    expect(await ui.find({ type: 'Text', text: '$3.00' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /20k tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /affreschi \$3\.00/ })).toBeDefined()
    await ui.unmount()
  }
})

test(
  'crossing 80% of the weekly budget is announced once',
  { options: { weeklyBudget: 10 } },
  async ($, on) => {
    const toasts: string[] = []
    await seed($, on, [0, 8.5, 9], toasts)
    await oneTurn($, 't1')
    await oneTurn($, 't2')

    expect(toasts).toEqual(["Il Golfo: sei all'80% del budget settimanale di $10.00"])
  }
)
