import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { describe, dueWaits, titleFor } from '../hooks/waits'

const MINUTE = 60_000

test('describe says what a call that needs you is waiting for', async () => {
  expect([
    describe('AskUserQuestion', {}),
    describe('ExitPlanMode', {}),
    describe('Bash', { command: 'git push origin feat/x\necho done' }),
    describe('WebFetch', { url: 'https://example.com' })
  ]).toEqual([
    'ti ha fatto una domanda',
    'ti propone un piano da approvare',
    'vuole il permesso per: git push origin feat/x',
    'vuole il permesso per usare WebFetch'
  ])
})

test('dueWaits picks the waits past the threshold that have not been called', async () => {
  const waits = new Map([
    ['a', { what: 'a', since: 0, isCalled: false }],
    ['b', { what: 'b', since: 0, isCalled: true }],
    ['c', { what: 'c', since: 2 * MINUTE, isCalled: false }]
  ])

  expect(dueWaits(waits, 3 * MINUTE, 3 * MINUTE)).toEqual(['a'])
})

test('titleFor counts the minutes', async () => {
  expect([titleFor(40_000), titleFor(4 * MINUTE)]).toEqual([
    'Claude ti aspetta da 1 minuto',
    'Claude ti aspetta da 4 minuti'
  ])
})

// A session where every tool call is put to you and every notification is collected.
async function seed(
  $: Engine,
  on: On,
  calls: { text: string; title?: string }[]
): Promise<MockClock> {
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => e)
  on('prompt.submit', async (_$, e) => e)
  on('tool.check', async () => ({ decision: 'ask' as const }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.notify', async (_$, e) => {
    calls.push(e)

    return { value: { isSent: true as const, channel: 'terminal_bell' } }
  })
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  return clock
}

const PUSH = { tool: 'Bash', input: { command: 'git push' }, tool_use_id: 'u1' }

test('a permission left waiting past the threshold calls you once', async ($, on) => {
  const calls: { text: string; title?: string }[] = []
  const clock = await seed($, on, calls)
  await $.tool.check(PUSH)
  await clock.advance(2 * MINUTE)

  expect(calls).toEqual([])

  await clock.advance(2 * MINUTE)
  await clock.advance(5 * MINUTE)

  expect(calls).toEqual([
    { text: 'vuole il permesso per: git push', title: 'Claude ti aspetta da 3 minuti' }
  ])
})

test('a permission answered in time calls nobody', async ($, on) => {
  const calls: { text: string; title?: string }[] = []
  const clock = await seed($, on, calls)
  await $.tool.check(PUSH)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'u1', command: 'git push' })
  await clock.advance(10 * MINUTE)

  expect(calls).toEqual([])
})

test('the threshold follows the option', { options: { minutes: 1 } }, async ($, on) => {
  const calls: { text: string; title?: string }[] = []
  const clock = await seed($, on, calls)
  await $.tool.check(PUSH)
  await clock.advance(MINUTE + 15_000)

  expect(calls.map(c => c.text)).toEqual(['vuole il permesso per: git push'])
})

test('a long turn that ends calls you, unless you write first', async ($, on) => {
  const calls: { text: string; title?: string }[] = []
  const clock = await seed($, on, calls)
  const longTurn = {
    turnId: 't1',
    answer: '',
    durationMs: 5 * MINUTE,
    isAborted: false,
    reason: 'answer' as const
  }

  await $.turn.complete(longTurn)
  await $.prompt.submit({ text: 'eccomi', wait: false, origin: { kind: 'composer' } })
  await clock.advance(10 * MINUTE)

  expect(calls).toEqual([])

  await $.turn.complete({ ...longTurn, turnId: 't2' })
  await clock.advance(4 * MINUTE)

  expect(calls.map(c => c.text)).toEqual(['ha finito: dai un’occhiata'])
})
