import type { AgentInfo, EngineInterface, ModelUsage, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { AgentUsage, Cleared, Role } from '../types'
import { ROLE_COLOR, ROLE_NAME, roleOf, SPRITE_WIDTH, type Sprite, spriteOf } from './cast'
import { VESUVIUS } from './palette'

const PANE = 'agent-usage'
export const MAIN = 'main'
// Dark text on a colored badge, whatever its color.
const BADGE_TEXT = '#1A1A1A'
// The empty part of a bar.
const TRACK = '#3A3A3A'
// Pulcinella's mask, and the white of his eyes and of every costume's props.
const MASK = '#1A1A1A'
const WHITE = '#F2EFE9'

const agents = atom({ plugin: 'agent-usage', key: 'agents' } as const, [])
const expanded = atom({ plugin: 'agent-usage', key: 'expanded' } as const, null)
const costUsd = atom({ plugin: 'agent-usage', key: 'costUsd' } as const, null)
const turn = atom({ plugin: 'agent-usage', key: 'turn' } as const, 0)
const openGroup = atom({ plugin: 'agent-usage', key: 'openGroup' } as const, null)
const NOTHING_CLEARED: Cleared = { tokens: 0, steps: 0 }
const cleared = atom({ plugin: 'agent-usage', key: 'cleared' } as const, NOTHING_CLEARED)

export function emptyUsage(
  id: string,
  label: string,
  type: string,
  lastTurn = 0,
  lastActiveAt = 0
): AgentUsage {
  return {
    lastTurn,
    lastActiveAt,
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

// The main conversation first, then the agents at work, then the rest, biggest first.
export function sorted(list: readonly AgentUsage[]): AgentUsage[] {
  const rank = (a: AgentUsage) => (a.id === MAIN ? 0 : isBusy(a) ? 1 : 2)

  return list.toSorted((a, b) => rank(a) - rank(b) || totalOf(b) - totalOf(a))
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

// How long a busy agent the engine no longer lists may stay quiet before it counts as finished.
export const STALE_MS = 30_000

// Polls since the module loaded: its own, so a reload starts it over.
let polls = 0
// How often the pane reads the agents again, so a background agent's progress shows live.
const POLL_MS = 2000

const mainRow = (): AgentUsage => ({
  ...emptyUsage(MAIN, 'Main conversation', 'main'),
  status: 'idle'
})

// A failure the mod lives through (a read it retries on the next beat, a band beneath that did
// not draw) goes to the debug log, never silently away.
function logFailure($: EngineInterface, what: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  $.ui.log(`agent-usage: ${what} failed: ${reason}`, { to: 'debug' })
}

// Folds the engine's list of agents into the rows: each known row takes its status (a change of
// status counts as activity in `currentTurn`), and an agent the hooks never saw (a teammate, one
// spawned before the mod loaded) gets a row of its own, on stage only while it is busy. A busy
// row the engine does not list, quiet for STALE_MS at `at`, has finished: an agent the engine
// does not know is not working, and nothing else would ever settle its row.
export function mergeKnown(
  list: readonly AgentUsage[],
  known: readonly AgentInfo[],
  currentTurn = 0,
  at = 0
): AgentUsage[] {
  const merged = list.map(a => {
    const info = known.find(k => k.id === a.id)

    if (info === undefined) {
      const lastActiveAt = Number.isFinite(a.lastActiveAt) ? a.lastActiveAt : 0
      const isStale = a.id !== MAIN && isBusy(a) && at - lastActiveAt >= STALE_MS

      // It keeps the turn it last worked in: stuck since an earlier turn, it goes straight to the
      // archive instead of showing up as just finished.
      return isStale ? { ...a, status: 'completed' as const } : a
    }

    return {
      ...a,
      status: info.status,
      label: a.label || info.description,
      type: a.type || info.type,
      lastTurn: info.status === a.status ? a.lastTurn : currentTurn
    }
  })
  const unseen = known
    .filter(k => !list.some(a => a.id === k.id))
    .map(k => ({
      ...emptyUsage(k.id, k.description || k.teammateId || '', k.type, -1),
      status: k.status
    }))

  return [...merged, ...unseen]
}

// On stage: the main conversation, every agent at work, and the ones that did something this turn.
// The rest wait in the archive.
export function isOnStage(a: AgentUsage, currentTurn: number): boolean {
  return a.id === MAIN || isBusy(a) || a.lastTurn >= currentTurn
}

export type Group = {
  role: Role
  agents: AgentUsage[]
  tokens: number
  failed: number
  types: string[]
}

// The archive, one group per role, the biggest first.
export function archiveOf(list: readonly AgentUsage[], currentTurn: number): Group[] {
  const groups = new Map<Role, AgentUsage[]>()

  for (const a of list) {
    if (!isOnStage(a, currentTurn)) {
      const role = roleOf(a, MAIN)
      groups.set(role, [...(groups.get(role) ?? []), a])
    }
  }

  return [...groups]
    .map(([role, agents]) => ({
      role,
      agents,
      tokens: agents.reduce((sum, a) => sum + totalOf(a), 0),
      failed: agents.filter(a => a.status === 'failed' || a.status === 'killed').length,
      types: [...new Set(agents.map(a => a.type).filter(t => t !== ''))]
    }))
    .toSorted((x, y) => y.tokens - x.tokens)
}

// Takes the archive off the list, keeping what it consumed in the totals.
async function clearArchive($: EngineInterface): Promise<void> {
  const now = await read($, turn)
  const list = await read($, agents)
  const archived = list.filter(a => !isOnStage(a, now))
  const tokens = archived.reduce((sum, a) => sum + totalOf(a), 0)
  const steps = archived.reduce((sum, a) => sum + a.steps, 0)
  await update($, cleared, c => ({ tokens: c.tokens + tokens, steps: c.steps + steps }))
  await update($, agents, l => l.filter(a => isOnStage(a, now)))
  await update($, openGroup, () => null)
}

// A row that just did something: active in `currentTurn` at `at`, and a subagent at work again
// if it had been set down as finished.
export function touched(a: AgentUsage, currentTurn: number, at: number): AgentUsage {
  const status = a.id === MAIN || isBusy(a) ? a.status : 'running'

  return { ...a, status, lastTurn: currentTurn, lastActiveAt: at }
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
  const next = mergeKnown(list, known, await read($, turn), await $.clock.now())

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

  // Every prompt opens a turn: what finished in the last one moves to the archive.
  on('prompt.submit', async ($, e, next) => {
    await update($, turn, t => t + 1)

    return next(e)
  })

  // A subagent starts: its row gets the task's description and type.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)

    if (result.agentId !== undefined) {
      const id = result.agentId
      const now = await read($, turn)
      await update($, agents, list =>
        upsert(
          list,
          id,
          a => ({
            ...a,
            label: e.description,
            type: e.subagentType,
            model: result.model,
            status: 'running',
            lastTurn: now
          }),
          () => emptyUsage(id, e.description, e.subagentType, now)
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
      const now = await read($, turn)
      const at = await $.clock.now()
      await update($, agents, list =>
        upsert(
          list,
          id,
          a => touched(addUsage(a, usage), now, at),
          () => (id === MAIN ? mainRow() : emptyUsage(id, '', '', now, at))
        )
      )
      await showStatus($)
    }

    return result
  })

  // Every tool call counts for the loop it runs in.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const now = await read($, turn)
    const at = await $.clock.now()
    await update($, agents, list =>
      upsert(
        list,
        id,
        a => touched({ ...a, tools: a.tools + 1 }, now, at),
        () => (id === MAIN ? mainRow() : emptyUsage(id, '', '', now, at))
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
      const now = await read($, turn)
      const finished = (await read($, agents)).find(a => a.id === id)
      await update($, agents, list =>
        list.map(a =>
          a.id === id
            ? {
                ...a,
                status: 'completed' as const,
                durationMs: result.totalDurationMs ?? a.durationMs,
                lastTurn: now
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
      const list = await read($, agents)
      const now = await read($, turn)
      const open = await read($, expanded)
      const group = await read($, openGroup)
      const cost = await read($, costUsd)
      const gone = await read($, cleared)
      const grand = list.reduce((sum, a) => sum + totalOf(a), gone.tokens)
      const requests = list.reduce((sum, a) => sum + a.steps, gone.steps)
      const stage = sorted(list.filter(a => isOnStage(a, now)))
      const archive = archiveOf(list, now)
      const running = list.filter(a => a.id !== MAIN && isBusy(a))
      const shareOf = (tokens: number) => (grand > 0 ? Math.round((tokens / grand) * 100) : 0)

      // A number under its name: the details are made of these.
      const tile = (label: string, value: string, color: string = 'text') => (
        <Box flexDirection="column">
          <Text color={VESUVIUS.ash}>{label}</Text>
          <Text color={color} bold>
            {value}
          </Text>
        </Box>
      )

      // A character, monospaced so its glyphs line up where the surface's font is proportional.
      const figure = (sprite: Sprite, color: string) => (
        <Box flexDirection="column" flexShrink={0}>
          {sprite.map(row => (
            <Text mono color={color}>
              {row.map(run =>
                run.tone === 'mask' ? (
                  <Text backgroundColor={MASK} color={WHITE}>
                    {run.text}
                  </Text>
                ) : run.tone === 'prop' ? (
                  <Text color={WHITE}>{run.text}</Text>
                ) : (
                  run.text
                )
              )}
            </Text>
          ))}
        </Box>
      )

      // Bars are boxes sized in percent, never counted characters: a desktop pane draws text in
      // a proportional font, where a row of block glyphs overflows.
      const bar = (percent: number, color: string) => (
        <Box flexDirection="row" height={1} backgroundColor={TRACK}>
          <Box width={`${percent}%`} height={1} backgroundColor={color}>
            <Text> </Text>
          </Box>
        </Box>
      )

      const header = (
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text color={VESUVIUS.lava}>◆</Text> <Text bold>Agent usage</Text>
            {grand > 0 && (
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
              {` ${running.length} AL LAVORO `}
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

      const actor = (a: AgentUsage) => {
        const role = roleOf(a, MAIN)
        const color = ROLE_COLOR[role]
        const total = totalOf(a)
        const share = shareOf(total)
        const model = a.model ? shortModel(a.model) : ''
        const when = a.status === 'completed' && a.id !== MAIN ? ' · this turn' : ''

        return (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={2}>
              {figure(spriteOf(role, a.status), color)}
              <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
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
                  <Text color={STATUS_COLOR[a.status]}>
                    {`${STATUS_GLYPH[a.status]} ${STATUS_LABEL[a.status]}${when}`}
                  </Text>
                </Box>
                {bar(total > 0 ? Math.max(1, share) : 0, color)}
                <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
                  <Text>
                    <Text bold>{formatTokens(total)}</Text>{' '}
                    <Text color={VESUVIUS.ash}>{`${share}%`}</Text>
                  </Text>
                  <Text color={VESUVIUS.ash} wrap="truncate-end">
                    {a.steps} {a.steps === 1 ? 'request' : 'requests'} · {a.tools} tool{' '}
                    {a.tools === 1 ? 'call' : 'calls'}
                  </Text>
                </Box>
              </Box>
            </Box>
            {a.id === open && (
              <Box flexDirection="row" columnGap={4} marginTop={1} marginLeft={SPRITE_WIDTH + 2}>
                {tile('INPUT', formatTokens(a.input), VESUVIUS.gulf)}
                {tile('OUTPUT', formatTokens(a.output), VESUVIUS.vineyard)}
                {tile('CACHE READ', formatTokens(a.cacheRead), VESUVIUS.sulfur)}
                {tile('CACHE WRITE', formatTokens(a.cacheWrite), VESUVIUS.tuff)}
                {tile('RAN', formatDuration(a.durationMs))}
              </Box>
            )}
          </Box>
        )
      }

      const shelf = (g: Group) => {
        const color = ROLE_COLOR[g.role]
        const [one, many] = ROLE_NAME[g.role]
        const isOpen = g.role === group

        return (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={2} alignItems="center">
              {figure(spriteOf(g.role, 'completed').slice(0, 2), color)}
              <Box flexDirection="row" flexGrow={1} justifyContent="space-between" columnGap={2}>
                <Box flexDirection="row" columnGap={1}>
                  <Button
                    key={`group-${g.role}`}
                    plain
                    label={`${g.agents.length === 1 ? one : many} ×${g.agents.length}`}
                    onPress={() => update($, openGroup, x => (x === g.role ? null : g.role))}
                  />
                  <Text color={VESUVIUS.ash} wrap="truncate-end">
                    {g.types.join(', ')}
                    {g.failed > 0 ? ' · ' : ''}
                    {g.failed > 0 && <Text color={VESUVIUS.lava}>{g.failed} failed</Text>}
                  </Text>
                </Box>
                <Text>
                  <Text bold>{formatTokens(g.tokens)}</Text>{' '}
                  <Text color={VESUVIUS.ash}>{`${shareOf(g.tokens)}% ${isOpen ? '▾' : '▸'}`}</Text>
                </Text>
              </Box>
            </Box>
            {isOpen &&
              g.agents.map(a => (
                <Box
                  flexDirection="row"
                  justifyContent="space-between"
                  marginLeft={SPRITE_WIDTH + 2}
                >
                  <Text wrap="truncate-end">
                    <Text color={STATUS_COLOR[a.status]}>{STATUS_GLYPH[a.status]}</Text>{' '}
                    {a.label || a.type || a.id}
                  </Text>
                  <Text color={VESUVIUS.ash}>
                    {formatTokens(totalOf(a))} · {formatDuration(a.durationMs)}
                  </Text>
                </Box>
              ))}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" rowGap={1}>
          {header}
          <Text color={VESUVIUS.ash}>IN SCENA</Text>
          <Box flexDirection="column" rowGap={1}>
            {stage.map(actor)}
          </Box>
          {archive.length > 0 && (
            <Box flexDirection="column">
              <Text color={VESUVIUS.ash}>ARCHIVIO · finished in earlier turns</Text>
              {archive.map(shelf)}
            </Box>
          )}
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={VESUVIUS.ash}>click a name for details · ▸ opens a group</Text>
            {archive.length > 0 && (
              <Button key="clear" plain label="svuota archivio" onPress={() => clearArchive($)} />
            )}
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
