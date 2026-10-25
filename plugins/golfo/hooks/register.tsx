import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { Days } from '../types'
import {
  daysFrom,
  formatTokens,
  formatUsd,
  lastWeek,
  markOf,
  projectsOf,
  record,
  sumOf,
  weekdayOf
} from './ledger'
import { VESUVIUS } from './palette'

const PANE = 'golfo'
const DAYS_KEY = 'days'
const ALERT_KEY = 'alert'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const TRACK = '#3A3A3A'
const TOP_PROJECTS = 4

const NO_DAYS: Days = {}
const NOT_COUNTED: number | null = null
const days = atom({ plugin: 'golfo', key: 'days' } as const, NO_DAYS)
const counted = atom({ plugin: 'golfo', key: 'counted' } as const, NOT_COUNTED)

// The module's own: the project the session works in, and tokens used since the last turn ended.
let project = ''
let pendingTokens = 0

function logFailure($: EngineInterface, what: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  $.ui.log(`golfo: ${what} failed: ${reason}`, { to: 'debug' })
}

async function sessionCost($: EngineInterface): Promise<number> {
  const usage = await $.session.usage().catch(error => {
    logFailure($, 'reading the cost', error)

    return undefined
  })

  return usage?.cost?.usd ?? 0
}

// The last budget mark announced and when, read back from the store.
async function lastAlert($: EngineInterface): Promise<{ mark: number; at: number }> {
  const value = await $.store.get(ALERT_KEY)
  const mark = typeof value === 'object' && value !== null && 'mark' in value ? value.mark : 0
  const at = typeof value === 'object' && value !== null && 'at' in value ? value.at : 0

  return { mark: typeof mark === 'number' ? mark : 0, at: typeof at === 'number' ? at : 0 }
}

// Adds what the session cost since it was last counted, and the tokens since, to today; then
// announces a budget mark the last seven days just reached, once a week per mark.
async function settle($: EngineInterface, budget: number): Promise<void> {
  const now = await $.clock.now()
  const cost = await sessionCost($)
  const before = (await read($, counted)) ?? cost
  const usd = Math.max(0, cost - before)
  const tokens = pendingTokens
  pendingTokens = 0
  await update($, counted, () => cost)

  if (usd === 0 && tokens === 0) {
    return
  }

  const stored = daysFrom(await $.store.get(DAYS_KEY))
  const next = record(stored, now, { usd, tokens, project })
  await $.store.set(DAYS_KEY, next)
  await update($, days, () => next)

  const mark = markOf(sumOf(lastWeek(next, now)).usd, budget)
  const alerted = await lastAlert($)
  const isNew = mark > 0 && (mark > alerted.mark || now - alerted.at >= WEEK_MS)

  if (isNew) {
    await $.store.set(ALERT_KEY, { mark, at: now })
    $.ui.toast(
      mark === 100
        ? `Il Golfo: budget settimanale superato · ${formatUsd(budget)}`
        : `Il Golfo: sei all'80% del budget settimanale di ${formatUsd(budget)}`
    )
  }
}

export const register: Register = (on, options) => {
  const budget = typeof options.weeklyBudget === 'number' ? options.weeklyBudget : 0

  on('session.start', async ($, e, next) => {
    project = e.cwd.split('/').filter(Boolean).at(-1) ?? e.cwd
    await $.command.register({
      name: 'golfo',
      description: 'Open Il Golfo: cost and tokens day by day, with the weekly budget',
      immediate: true
    })
    const stored = daysFrom(await $.store.get(DAYS_KEY))
    await update($, days, () => stored)

    if ((await read($, counted)) === null) {
      const cost = await sessionCost($)
      await update($, counted, () => cost)
    }

    return next(e)
  })

  on('command.run', { command: 'golfo' }, async $ => {
    await settle($, budget).catch(error => logFailure($, 'counting the cost', error))
    await $.ui.open({ id: PANE, title: 'Il Golfo', focus: true, closeOnEscape: true })

    return {}
  })

  // Every model request, the main loop's and the subagents': its tokens wait for the turn's end.
  on('turn.step', async function* (_$, e, next) {
    const result = yield* next(e)
    const usage = result.usage

    if (usage !== null) {
      pendingTokens +=
        usage.input_tokens +
        usage.output_tokens +
        usage.cache_read_input_tokens +
        usage.cache_creation_input_tokens
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await settle($, budget).catch(error => logFailure($, 'counting the cost', error))

    return result
  })

  // The pane: the last seven days as bars, the week against the budget, and the projects.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const week = lastWeek(await read($, days), now)
    const total = sumOf(week)
    const peak = Math.max(...week.map(({ day }) => day.usd))
    const priciest = week.find(({ day }) => day.usd === peak && peak > 0)
    const projects = projectsOf(week).slice(0, TOP_PROJECTS)
    const used = budget > 0 ? Math.round((total.usd / budget) * 100) : 0
    const budgetColor = used >= 100 ? VESUVIUS.lava : used >= 80 ? VESUVIUS.magma : VESUVIUS.gulf

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text color={VESUVIUS.gulf}>≋</Text> <Text bold>Il Golfo</Text>
            <Text color={VESUVIUS.ash}> · last 7 days · {formatTokens(total.tokens)} tokens</Text>
          </Text>
          <Text>
            <Text bold>{formatUsd(total.usd)}</Text>
            {budget > 0 && (
              <Text color={budgetColor}>
                {' '}
                of {formatUsd(budget)} · {used}%
              </Text>
            )}
          </Text>
        </Box>
        {budget > 0 && (
          <Box flexDirection="row" height={1} backgroundColor={TRACK}>
            <Box width={`${Math.min(100, used)}%`} height={1} backgroundColor={budgetColor}>
              <Text> </Text>
            </Box>
          </Box>
        )}
        <Box flexDirection="column">
          {week.map(({ at, key, day }, i) => {
            const isToday = i === week.length - 1
            const share =
              peak > 0 ? Math.max(day.usd > 0 ? 1 : 0, Math.round((day.usd / peak) * 100)) : 0
            const color = isToday
              ? VESUVIUS.lava
              : day.usd === peak && peak > 0
                ? VESUVIUS.magma
                : VESUVIUS.gulf

            return (
              <Box key={key} flexDirection="row" columnGap={1}>
                {/* Monospaced, so the days and amounts line up in columns on every surface. */}
                <Text mono color={isToday ? 'text' : VESUVIUS.ash} bold={isToday}>
                  {`${isToday ? 'oggi' : weekdayOf(at).padEnd(4)} ${key.slice(8)}`}
                </Text>
                <Box flexDirection="row" flexGrow={1} height={1}>
                  <Box width={`${share}%`} height={1} backgroundColor={color}>
                    <Text> </Text>
                  </Box>
                </Box>
                <Text mono>
                  {formatUsd(day.usd).padStart(8)}{' '}
                  <Text color={VESUVIUS.ash}>{formatTokens(day.tokens).padStart(6)}</Text>
                </Text>
              </Box>
            )
          })}
        </Box>
        <Text color={VESUVIUS.ash} wrap="truncate-end">
          {priciest === undefined
            ? 'Nothing spent in the last seven days.'
            : `Priciest day: ${weekdayOf(priciest.at)} ${priciest.key.slice(8)} · ${formatUsd(priciest.day.usd)}`}
          {projects.length > 0 ? ' · ' : ''}
          {projects.map(([name, usd]) => `${name} ${formatUsd(usd)}`).join(' · ')}
        </Text>
      </Box>
    )
  })
}
