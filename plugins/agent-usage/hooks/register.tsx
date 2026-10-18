import type { AgentInfo, EngineInterface, ModelUsage, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { AgentUsage } from '../types'
import { SEQUENCE, VESUVIUS } from './palette'

const PANE = 'agent-usage'
export const MAIN = 'main'
// Dark text on a colored badge, whatever its color.
const BADGE_TEXT = '#1A1A1A'
// The empty part of a bar.
const TRACK = '#3A3A3A'

const agents = atom({ plugin: 'agent-usage', key: 'agents' } as const, [])
const expanded = atom({ plugin: 'agent-usage', key: 'expanded' } as const, null)
const costUsd = atom({ plugin: 'agent-usage', key: 'costUsd' } as const, null)

export function emptyUsage(id: string, label: string, type: string): AgentUsage {
  return {
    id,
    label,
    type,
    model: '',
    status: 'running',
    steps: 0,
    tools: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    durationMs: null
  }
}

export function totalOf(a: AgentUsage): number {
  return a.input + a.output + a.cacheRead + a.cacheWrite
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }

  if (n >= 10_000) {
    return `${Math.round(n / 1000)}k`
  }

  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`
  }

  return String(n)
}

export function formatDuration(ms: number | null): string {
  if (ms === null) {
    return '—'
  }

  const s = Math.round(ms / 1000)

  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

// Adds or changes one agent's row, creating it when it is new.
export function upsert(
  list: readonly AgentUsage[],
  id: string,
  change: (a: AgentUsage) => AgentUsage,
  fallback: () => AgentUsage
): AgentUsage[] {
  const found = list.find(a => a.id === id)

  return found === undefined
    ? [...list, change(fallback())]
    : list.map(a => (a.id === id ? change(a) : a))
}

export function addUsage(a: AgentUsage, usage: ModelUsage & { model?: string }): AgentUsage {
  return {
    ...a,
    model: usage.model ?? a.model,
    steps: a.steps + 1,
    input: a.input + usage.input_tokens,
    output: a.output + usage.output_tokens,
    cacheRead: a.cacheRead + usage.cache_read_input_tokens,
    cacheWrite: a.cacheWrite + usage.cache_creation_input_tokens
  }
}

// The main conversation first, then the subagents, biggest first.
export function sorted(list: readonly AgentUsage[]): AgentUsage[] {
  return [...list].sort((a, b) =>
    a.id === MAIN ? -1 : b.id === MAIN ? 1 : totalOf(b) - totalOf(a)
  )
}

const STATUS_GLYPH: Record<AgentUsage['status'], string> = {
  pending: '◌',
  running: '●',
  waiting: '◐',
  idle: '○',
  completed: '✓',
  failed: '✗',
  killed: '✗'
}

// Each agent's mascot, three rows of block glyphs: its eyes say what it is doing.
const BODY = '▝▜█████▛▘'
const FEET = '  ▘▘ ▝▝  '
const FEET_RESTING = '  ▝▝ ▘▘  '

// Every status names its mascot, so a status the engine adds fails to compile until it has one.
const MASCOTS: Record<AgentUsage['status'], readonly [string, string, string]> = {
  running: [' ▐▛███▜▌ ', BODY, FEET],
  waiting: [' ▐▛███▜▌ ', BODY, FEET],
  completed: [' ▐▛▀█▀▜▌ ', BODY, FEET],
  failed: [' ▐▛▚█▞▜▌ ', BODY, FEET_RESTING],
  killed: [' ▐▛▚█▞▜▌ ', BODY, FEET_RESTING],
  pending: [' ▐▛▄█▄▜▌ ', BODY, FEET_RESTING],
  idle: [' ▐▛▄█▄▜▌ ', BODY, FEET_RESTING]
}

export function mascotOf(status: AgentUsage['status']): readonly [string, string, string] {
  return MASCOTS[status]
}

const STATUS_LABEL: Record<AgentUsage['status'], string> = {
  pending: 'starting',
  running: 'working',
  waiting: 'waiting',
  idle: 'idle',
  completed: 'done',
  failed: 'failed',
  killed: 'stopped'
}

const STATUS_COLOR: Record<AgentUsage['status'], string> = {
  running: VESUVIUS.magma,
  waiting: VESUVIUS.magma,
  failed: VESUVIUS.lava,
  killed: VESUVIUS.lava,
  completed: VESUVIUS.vineyard,
  pending: VESUVIUS.ash,
  idle: VESUVIUS.ash
}

// A foreground Agent call's result, checked field by field: the agent it ran and how long,
// when it completed; nothing for any other result.
export function completedAgentOf(
  result: unknown
): { agentId: string; totalDurationMs: number | null } | undefined {
  if (typeof result !== 'object' || result === null) {
    return undefined
  }

  const status = 'status' in result ? result.status : undefined
  const agentId = 'agentId' in result ? result.agentId : undefined
  const duration = 'totalDurationMs' in result ? result.totalDurationMs : undefined

  if (status !== 'completed' || typeof agentId !== 'string') {
    return undefined
  }

  return { agentId, totalDurationMs: typeof duration === 'number' ? duration : null }
}

// Polls since the module loaded: its own, so a reload starts it over.
let polls = 0
// How often the pane reads the agents again, so a background agent's progress shows live.
const POLL_MS = 2000

const mainRow = () => ({
  ...emptyUsage(MAIN, 'Main conversation', 'main'),
  status: 'idle' as const
})

// A failure the mod lives through (a read it retries on the next beat, a band beneath that did
// not draw) goes to the debug log, never silently away.
function logFailure($: EngineInterface, what: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  $.ui.log(`agent-usage: ${what} failed: ${reason}`, { to: 'debug' })
}

// Folds the engine's list of agents into the rows: each known row takes its status, and an agent
// the hooks never saw (a teammate, one spawned before the mod loaded) gets a row of its own.
export function mergeKnown(list: readonly AgentUsage[], known: readonly AgentInfo[]): AgentUsage[] {
  const merged = list.map(a => {
    const info = known.find(k => k.id === a.id)

    return info === undefined
      ? a
      : { ...a, status: info.status, label: a.label || info.description, type: a.type || info.type }
  })
  const unseen = known
    .filter(k => !list.some(a => a.id === k.id))
    .map(k => ({
      ...emptyUsage(k.id, k.description || k.teammateId || '', k.type),
      status: k.status
    }))

  return [...merged, ...unseen]
}

function isBusy(a: AgentUsage): boolean {
  return a.status === 'running' || a.status === 'waiting' || a.status === 'pending'
}

// Reads the agents' status and cost from the engine, writing only what changed so the pane
// redraws when something moved and not on every poll.
async function refresh($: EngineInterface): Promise<void> {
  const known = await $.agent.list().catch(error => {
    logFailure($, 'listing the agents', error)

    return []
  })
  const usage = await $.session.usage().catch(error => {
    logFailure($, 'reading the cost', error)

    return undefined
  })
  const list = await read($, agents)
  const next = mergeKnown(list, known)

  if (JSON.stringify(next) !== JSON.stringify(list)) {
    await update($, agents, () => next)
  }

  const cost = usage?.cost?.usd ?? null

  if ((await read($, costUsd)) !== cost) {
    await update($, costUsd, () => cost)
  }
}

// One poll: every beat while an agent runs, every fifth when all are quiet.
async function poll($: EngineInterface): Promise<void> {
  polls += 1
  const list = await read($, agents)

  if (list.some(isBusy) || polls % 5 === 0) {
    await refresh($)
    await showStatus($)
  }
}

// The status line while subagents run: how many, and what they consumed so far.
async function showStatus($: EngineInterface): Promise<void> {
  const list = await read($, agents)
  const running = list.filter(
    a => a.id !== MAIN && (a.status === 'running' || a.status === 'waiting')
  )

  if (running.length === 0) {
    $.ui.status(undefined)

    return
  }

  const tokens = running.reduce((sum, a) => sum + totalOf(a), 0)
  $.ui.status(
    `▲ ${running.length} ${running.length === 1 ? 'agent' : 'agents'} running · ${formatTokens(tokens)} tokens`
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-usage',
      description: 'Open the pane with the tokens each agent consumed',
      immediate: true
    })
    $.clock.every(POLL_MS, () => {
      poll($).catch(error => logFailure($, 'polling the agents', error))
    })

    return next(e)
  })

  on('command.run', { command: 'agent-usage' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Agent usage', focus: true, closeOnEscape: true })

    return {}
  })

  // A subagent starts: its row gets the task's description and type.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)

    if (result.agentId !== undefined) {
      const id = result.agentId
      await update($, agents, list =>
        upsert(
          list,
          id,
          a => ({
            ...a,
            label: e.description,
            type: e.subagentType,
            model: result.model,
            status: 'running'
          }),
          () => emptyUsage(id, e.description, e.subagentType)
        )
      )
      await showStatus($)
    }

    return result
  })

  // Every model request, in the main loop or in a subagent's: its tokens go to that loop.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage

    if (usage !== null) {
      const id = e.agentId ?? MAIN
      await update($, agents, list =>
        upsert(
          list,
          id,
          a => addUsage(a, usage),
          () => (id === MAIN ? mainRow() : emptyUsage(id, '', ''))
        )
      )
      await showStatus($)
    }

    return result
  })

  // Every tool call counts for the loop it runs in.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    await update($, agents, list =>
      upsert(
        list,
        id,
        a => ({ ...a, tools: a.tools + 1 }),
        () => (id === MAIN ? mainRow() : emptyUsage(id, '', ''))
      )
    )

    return next(e)
  })

  // A foreground subagent ends: its Agent call reports how long it ran.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    const result = completedAgentOf(ran.result)

    if (result !== undefined) {
      const id = result.agentId
      const finished = (await read($, agents)).find(a => a.id === id)
      await update($, agents, list =>
        list.map(a =>
          a.id === id
            ? {
                ...a,
                status: 'completed' as const,
                durationMs: result.totalDurationMs ?? a.durationMs
              }
            : a
        )
      )

      if (finished !== undefined) {
        $.ui.toast(
          `✓ ${finished.label || finished.type} · ${formatTokens(totalOf(finished))} tokens`
        )
      }

      await showStatus($)
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    await showStatus($)

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)

    // A failure while drawing shows in the pane itself, never as an empty pane.
    try {
      const list = sorted(await read($, agents))
      const open = await read($, expanded)
      const cost = await read($, costUsd)
      const grand = list.reduce((sum, a) => sum + totalOf(a), 0)
      const subagents = list.filter(a => a.id !== MAIN)
      const running = subagents.filter(a => a.status === 'running' || a.status === 'waiting')

      // A number under its name: the cards are made of these.
      const tile = (label: string, value: string, color: string = 'text') => (
        <Box flexDirection="column">
          <Text color={VESUVIUS.ash}>{label}</Text>
          <Text color={color} bold>
            {value}
          </Text>
        </Box>
      )

      const requests = list.reduce((sum, a) => sum + a.steps, 0)
      const header = (
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text color={VESUVIUS.lava}>◆</Text> <Text bold>Agent usage</Text>
            {list.length > 0 && (
              <Text color={VESUVIUS.ash}>
                {' '}
                · {formatTokens(grand)} tokens
                {cost !== null ? ' · ' : ''}
                {cost !== null && <Text color={VESUVIUS.tuff}>${cost.toFixed(2)}</Text>} ·{' '}
                {requests} {requests === 1 ? 'request' : 'requests'}
              </Text>
            )}
          </Text>
          {running.length > 0 ? (
            <Text backgroundColor={VESUVIUS.magma} color={BADGE_TEXT} bold>
              {` ${running.length} RUNNING `}
            </Text>
          ) : (
            <Text color={VESUVIUS.ash}>idle</Text>
          )}
        </Box>
      )

      if (list.length === 0) {
        return (
          <Box flexDirection="column" rowGap={1}>
            {header}
            <Text color={VESUVIUS.ash}>No model requests yet.</Text>
          </Box>
        )
      }

      return (
        <Box flexDirection="column" rowGap={1}>
          {header}
          <Box flexDirection="column" rowGap={1}>
            {list.map((a, i) => {
              const total = totalOf(a)
              const share = grand > 0 ? total / grand : 0
              const percent = total > 0 ? Math.max(1, Math.round(share * 100)) : 0
              const color = SEQUENCE[i % SEQUENCE.length] ?? VESUVIUS.lava
              const isOpen = a.id === open
              const model = a.model ? shortModel(a.model) : ''

              return (
                <Box flexDirection="column">
                  <Box flexDirection="row" columnGap={2}>
                    {/* Monospaced, so the glyphs line up where the surface's font is proportional. */}
                    <Box flexDirection="column" flexShrink={0}>
                      {mascotOf(a.status).map(line => (
                        <Text color={color} mono>
                          {line}
                        </Text>
                      ))}
                    </Box>
                    <Box flexDirection="column" flexGrow={1}>
                      <Box flexDirection="row" justifyContent="space-between">
                        {/* A Button takes a label only: the model sits beside it. */}
                        <Box flexDirection="row" columnGap={1}>
                          <Button
                            key={`agent-${a.id}`}
                            plain
                            label={a.label || a.type || a.id}
                            onPress={() => update($, expanded, x => (x === a.id ? null : a.id))}
                          />
                          <Text color={VESUVIUS.ash} wrap="truncate-end">
                            {model}
                            {a.type !== 'main' && a.type !== '' ? ` · ${a.type}` : ''}
                          </Text>
                        </Box>
                        <Text
                          color={STATUS_COLOR[a.status]}
                        >{`${STATUS_GLYPH[a.status]} ${STATUS_LABEL[a.status]}`}</Text>
                      </Box>
                      {/* Bars are boxes sized in percent, never counted characters: a desktop pane draws
                      text in a proportional font, where a row of block glyphs overflows. */}
                      <Box flexDirection="row" height={1} backgroundColor={TRACK}>
                        <Box width={`${percent}%`} height={1} backgroundColor={color}>
                          <Text> </Text>
                        </Box>
                      </Box>
                      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
                        <Text>
                          <Text bold>{formatTokens(total)}</Text>{' '}
                          <Text color={VESUVIUS.ash}>{`${Math.round(share * 100)}%`}</Text>
                        </Text>
                        <Text color={VESUVIUS.ash} wrap="truncate-end">
                          {a.steps} {a.steps === 1 ? 'request' : 'requests'} · {a.tools} tool{' '}
                          {a.tools === 1 ? 'call' : 'calls'}
                        </Text>
                      </Box>
                    </Box>
                  </Box>
                  {isOpen && (
                    <Box flexDirection="row" columnGap={4} marginTop={1} marginLeft={11}>
                      {tile('INPUT', formatTokens(a.input), VESUVIUS.gulf)}
                      {tile('OUTPUT', formatTokens(a.output), VESUVIUS.vineyard)}
                      {tile('CACHE READ', formatTokens(a.cacheRead), VESUVIUS.sulfur)}
                      {tile('CACHE WRITE', formatTokens(a.cacheWrite), VESUVIUS.tuff)}
                      {tile('RAN', formatDuration(a.durationMs))}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={VESUVIUS.ash}>click a name for details · /agent-usage to refresh</Text>
            <Button key="reset" plain label="reset" onPress={() => update($, agents, () => [])} />
          </Box>
        </Box>
      )
    } catch (error) {
      return (
        <Text color={VESUVIUS.lava} wrap="wrap">
          agent-usage could not draw: {error instanceof Error ? error.message : String(error)}
        </Text>
      )
    }
  })
}
