import type { EngineInterface, Register } from 'claude-code'

import { describe, dueWaits, titleFor, type Wait } from './waits'

// How often the waits are looked at, and how long a turn must last for its end to be worth a call.
const CHECK_MS = 15_000
const LONG_TURN_MS = 2 * 60 * 1000
const TURN = 'turn'

// The module's own: what Claude waits on you for, by tool call (or the finished turn).
const waits = new Map<string, Wait>()

function logFailure($: EngineInterface, what: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  $.ui.log(`lazzarone: ${what} failed: ${reason}`, { to: 'debug' })
}

// Calls you, once per wait, for every wait that has lasted long enough.
async function check($: EngineInterface, afterMs: number): Promise<void> {
  const now = await $.clock.now()

  for (const id of dueWaits(waits, now, afterMs)) {
    const wait = waits.get(id)

    if (wait !== undefined) {
      waits.set(id, { ...wait, isCalled: true })
      await $.ui.notify(wait.what, { title: titleFor(now - wait.since) })
    }
  }
}

export const register: Register = (on, options) => {
  const minutes = typeof options.minutes === 'number' && options.minutes > 0 ? options.minutes : 3
  const afterMs = minutes * 60_000

  on('session.start', async ($, e, next) => {
    waits.clear()
    $.clock.every(CHECK_MS, () => {
      check($, afterMs).catch(error => logFailure($, 'calling you', error))
    })

    return next(e)
  })

  // A call the engine puts to you (a permission, a question, a plan) starts a wait.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)

    if (verdict.decision === 'ask' && e.tool_use_id !== undefined) {
      waits.set(e.tool_use_id, {
        what: describe(e.tool, e.input),
        since: await $.clock.now(),
        isCalled: false
      })
    }

    return verdict
  })

  // However the call went (run, refused, answered), its wait is over.
  on('tool.call', async (_$, e, next) => {
    try {
      return await next(e)
    } finally {
      waits.delete(e.tool_use_id)
    }
  })

  // A long turn that ends leaves Claude waiting for your next word.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (!e.isAborted && e.durationMs >= LONG_TURN_MS) {
      waits.set(TURN, {
        what: 'ha finito: dai un’occhiata',
        since: await $.clock.now(),
        isCalled: false
      })
    }

    return result
  })

  // You are back: nothing is waiting any more.
  on('prompt.submit', async (_$, e, next) => {
    waits.clear()

    return next(e)
  })
}
