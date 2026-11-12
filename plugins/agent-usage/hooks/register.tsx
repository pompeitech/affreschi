import type { AgentInfo, EngineInterface, ModelUsage, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { Activity, AgentUsage, Cleared, Phase, Role } from '../types'
import { avatarSvg } from './avatar'
import { blockColors, blockSvg } from './blocks'
import { ROLE_COLOR, ROLE_NAME, roleOf, SPRITE_WIDTH, type Sprite, spriteOf } from './cast'
import { VESUVIUS } from './palette'

const sessionTab = atom({ plugin: 'agent-usage', key: 'sessionTab' } as const, false)
const initial: Activity[] = []
const timeline = atom({ plugin: 'agent-usage', key: 'timeline' } as const, initial)
const permissions = atom({ plugin: 'agent-usage', key: 'permissions' } as const, {
  allow: 0,
  ask: 0,
  deny: 0
})
const contextUsage = atom({ plugin: 'agent-usage', key: 'contextUsage' } as const, null)

async function record($: EngineInterface, agent: string, label: string, phase: Phase, at?: number) {
  try {
    const time = at ?? (await $.clock.now())
    await update($, timeline, entries =>
      [...entries, { agent, label, phase, time }].sort((a, b) => a.time - b.time).slice(-80)
    )
  } catch (error) {
    $.ui.log(`Regia: registro non disponibile (${String(error)})`, { to: 'debug' })
  }
}

const PHASE_COLOR = {
  Richiesta: VESUVIUS.tuff,
  Consulto: '#B69ADC',
  Esecuzione: VESUVIUS.magma,
  Verifica: VESUVIUS.gulf,
  Concluso: VESUVIUS.vineyard
}

const PANE = 'agent-usage'
export const MAIN = 'main'
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
  pending: 'in avvio',
  running: 'al lavoro',
  waiting: 'in attesa',
  idle: 'in pausa',
  completed: 'completato',
  failed: 'errore',
  killed: 'interrotto'
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
  ...emptyUsage(MAIN, 'Conversazione principale', 'main'),
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

      return isStale ? { ...a, status: 'completed' as const, lastTurn: currentTurn } : a
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
  const ctx = usage?.context
  const nextContext =
    ctx?.percent !== undefined && ctx.tokens !== undefined && ctx.window > 0
      ? { tokens: ctx.tokens, window: ctx.window, percent: ctx.percent }
      : null

  if (usage && JSON.stringify(await read($, contextUsage)) !== JSON.stringify(nextContext)) {
    await update($, contextUsage, () => nextContext)
  }

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
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)

    if (e.tool_use_id !== undefined) {
      await update($, permissions, counts => ({
        ...counts,
        [verdict.decision]: counts[verdict.decision] + 1
      })).catch(error => $.ui.log(String(error), { to: 'debug' }))
    }

    return verdict
  })
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-usage',
      description: 'Open the pane with the tokens each agent consumed',
      immediate: true
    })
    await $.command.register({
      name: 'regia',
      description: 'Apri la regia della sessione',
      immediate: true
    })
    $.clock.every(POLL_MS, () => {
      poll($).catch(error => logFailure($, 'polling the agents', error))
    })

    return next(e)
  })

  on('command.run', { command: 'regia' }, async $ => {
    await update($, sessionTab, () => true)
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Regia', focus: true, closeOnEscape: true })

    return {}
  })

  on('command.run', { command: 'agent-usage' }, async $ => {
    await refresh($)
    await update($, sessionTab, () => false)
    await $.ui.open({ id: PANE, title: 'Regia', focus: true, closeOnEscape: true })

    return {}
  })

  // Every prompt opens a turn: what finished in the last one moves to the archive.
  on('prompt.submit', async ($, e, next) => {
    await update($, turn, t => t + 1)
    await record($, MAIN, 'Richiesta ricevuta', 'Richiesta')

    return next(e)
  })

  // A subagent starts: its row gets the task's description and type.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)

    if (result.agentId !== undefined) {
      const id = result.agentId
      await record(
        $,
        id,
        e.description || e.subagentType,
        /architect/i.test(e.subagentType) ? 'Consulto' : 'Esecuzione'
      )
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
    for (const use of result.serverToolUses ?? []) {
      if (use.name === 'advisor') {
        await record($, e.agentId ?? MAIN, 'Consulto architetto', 'Consulto', use.startedAt)
        if (use.endedAt !== undefined) {
          await record($, e.agentId ?? MAIN, 'Parere ricevuto', 'Esecuzione', use.endedAt)
        }
      }
    }

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

    const result = await next(e)
    const checking = e.tool === 'Bash' && /\b(test|vitest|jest|pytest|playwright)\b/.test(e.command)
    const label = result.deny !== undefined ? 'Negato' : result.isError ? 'Errore' : 'Eseguito'
    await record($, id, `${label} · ${e.tool}`, checking ? 'Verifica' : 'Esecuzione')

    return result
  })

  // A foreground subagent ends: its Agent call reports how long it ran.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    const result = completedAgentOf(ran.result)

    if (result !== undefined) {
      const id = result.agentId
      await record($, id, 'Agente completato', 'Concluso')
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
    await record($, MAIN, 'Turno concluso', 'Concluso')
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

      const inSession = await read($, sessionTab)
      const entries = (await read($, timeline)).slice().reverse()
      const journal = (events: Activity[], showAgent = false) =>
        events.map(entry => (
          <Box flexDirection="row" columnGap={1}>
            <Text mono color={VESUVIUS.ash}>
              {new Date(entry.time).toLocaleTimeString('it-IT')}
            </Text>
            <Text color={PHASE_COLOR[entry.phase]}>●</Text>
            <Text wrap="truncate-end">
              {showAgent && (
                <Text color={VESUVIUS.ash}>
                  {entry.agent === MAIN
                    ? 'Pulcinella'
                    : list.find(a => a.id === entry.agent)?.type || 'Agente'}{' '}
                  ·{' '}
                </Text>
              )}
              {entry.label}
            </Text>
          </Box>
        ))
      const desktop = e.surface === 'desktop'
      const surface = $.ui.resolve(e)
      const Svg = e.surface !== 'terminal' && 'Svg' in surface ? surface.Svg : undefined
      const card = desktop
        ? {
            borderStyle: 'round',
            borderColor: '#394244',
            backgroundColor: '#1C2224',
            paddingX: 'md' as const,
            paddingY: 'sm' as const
          }
        : {}
      const metric = (value: string, caption: string) => (
        <Box flexDirection="column" flexGrow={1}>
          <Text size="heading" mono weight="semibold" color="#F1EFEA">
            {value}
          </Text>
          <Text size="caption" color="#AFB8B6">
            {caption}
          </Text>
        </Box>
      )
      const heading = desktop ? (
        <Box flexDirection="column" rowGap="sm">
          <Text size="footnote" color="#B9C2C0">
            <Text color="#FFAC72">◈ </Text> Affreschi / Claude Code
          </Text>
          <Text size="title" weight="bold">
            Regia
          </Text>
          <Box flexDirection="row" columnGap="sm">
            <Button
              key="sessione"
              variant={inSession ? 'primary' : 'secondary'}
              label="Sessione"
              onPress={() => update($, sessionTab, () => true)}
            />
            <Button
              key="agenti"
              variant={inSession ? 'secondary' : 'primary'}
              label="Agenti"
              onPress={() => update($, sessionTab, () => false)}
            />
          </Box>
          <Box
            {...card}
            backgroundColor="#2B2926"
            borderColor="#49433C"
            flexDirection="column"
            rowGap="sm"
          >
            <Text size="caption" mono color="#CBBDB0">
              CONSUMI DI SESSIONE
            </Text>
            <Box flexDirection="row" flexWrap="wrap" columnGap="md">
              {metric(formatTokens(grand), 'token')}
              {metric(cost === null ? '—' : `$${cost.toFixed(2)}`, 'costo sessione')}
              {metric(String(requests), 'richieste')}
            </Box>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={VESUVIUS.tuff}>
              ◈ Regia
            </Text>
            <Text color={running.length ? VESUVIUS.magma : VESUVIUS.ash}>
              {running.length} al lavoro
            </Text>
          </Box>
          <Box flexDirection="row" columnGap={2}>
            <Button
              plain
              key="sessione"
              label={inSession ? '● Sessione' : 'Sessione'}
              onPress={() => update($, sessionTab, () => true)}
            />
            <Button
              plain
              key="agenti"
              label={inSession ? 'Agenti' : '● Agenti'}
              onPress={() => update($, sessionTab, () => false)}
            />
          </Box>
          <Text color={VESUVIUS.tuff}>
            {formatTokens(grand)} token · {requests} richieste
            {cost === null ? '' : ` · $${cost.toFixed(2)}`}
          </Text>
        </Box>
      )

      if (inSession) {
        const checks = await read($, permissions)
        const ctx = await read($, contextUsage)
        const current = entries[0]
        const colors = ctx
          ? blockColors(
              [
                { weight: ctx.tokens, color: VESUVIUS.magma },
                { weight: Math.max(0, ctx.window - ctx.tokens), color: '#454846' }
              ],
              Math.max(1, Math.min(42, Math.floor(e.props.bodyColumns / 2)))
            )
          : []

        return (
          <Box flexDirection="column" rowGap={desktop ? 'md' : 1} paddingX={desktop ? 'sm' : 0}>
            {heading}
            <Box {...card} flexDirection="column">
              <Text bold>
                Turno {now} · {current?.phase ?? 'In attesa'}
              </Text>
              <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                {(['Richiesta', 'Consulto', 'Esecuzione', 'Verifica', 'Concluso'] as const).map(
                  phase => (
                    <Text
                      color={current?.phase === phase ? PHASE_COLOR[phase] : VESUVIUS.ash}
                      bold={current?.phase === phase}
                    >
                      {current?.phase === phase ? '● ' : ''}
                      {phase}
                    </Text>
                  )
                )}
              </Box>
              {current && <Text color={PHASE_COLOR[current.phase]}>{current.label}</Text>}
            </Box>
            {ctx && (
              <Box {...card} flexDirection="column">
                <Text bold>Contesto · {ctx.percent}%</Text>
                {Svg ? (
                  <Svg source={blockSvg(colors)} alt={`Contesto: ${ctx.percent}%`} />
                ) : (
                  <Text mono>
                    {colors.map(color => (
                      <Text color={color}>▪ </Text>
                    ))}
                  </Text>
                )}
                <Text color={VESUVIUS.ash}>
                  {formatTokens(ctx.tokens)} / {formatTokens(ctx.window)} token
                </Text>
              </Box>
            )}
            <Box {...card} flexDirection="column">
              <Text bold>Permessi</Text>
              <Text>
                {checks.allow} consentiti · {checks.ask} da confermare · {checks.deny} negati
              </Text>
            </Box>
            <Box {...card} flexDirection="column">
              <Text bold>Registro della sessione</Text>
              {entries.length ? (
                journal(entries.slice(0, 12), true)
              ) : (
                <Text color={VESUVIUS.ash}>In attesa del primo evento</Text>
              )}
            </Box>
          </Box>
        )
      }

      if (list.length === 0) {
        return (
          <Box flexDirection="column" rowGap={1}>
            {heading}
            <Text color={VESUVIUS.ash}>In attesa della prima richiesta.</Text>
          </Box>
        )
      }

      const actor = (a: AgentUsage) => {
        const role = roleOf(a, MAIN)
        const color = ROLE_COLOR[role]
        const total = totalOf(a)
        const share = shareOf(total)
        const model = a.model ? shortModel(a.model) : ''
        const displayModel = model.replace(
          /^(opus|sonnet|haiku)-(\d+)(?:-(\d+))?$/i,
          (_, family: string, major: string, minor?: string) =>
            `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
        )
        const when = a.status === 'completed' && a.id !== MAIN ? ' · questo turno' : ''

        return (
          <Box flexDirection="column">
            {desktop && Svg ? (
              <Box flexDirection="row" columnGap="sm" alignItems="center" paddingY="sm">
                <Box flexShrink={0}>
                  <Svg
                    source={avatarSvg(role, a.status)}
                    width={40}
                    height={40}
                    alt={ROLE_NAME[role][0]}
                  />
                </Box>
                <Box flexDirection="column" width={0} minWidth={0} flexGrow={1} overflow="hidden">
                  <Button
                    key={`agent-${a.id}`}
                    plain
                    label={a.id === MAIN ? 'Conversazione principale' : a.label || a.type || a.id}
                    onPress={() => update($, expanded, x => (x === a.id ? null : a.id))}
                  />
                  <Text size="footnote" wrap="truncate-end" color="#AFB8B6">
                    {displayModel || a.type} ·{' '}
                    <Text color={STATUS_COLOR[a.status]}>{STATUS_LABEL[a.status]}</Text>
                  </Text>
                </Box>
                <Box flexDirection="column" alignItems="flex-end" flexShrink={0}>
                  <Text mono weight="semibold" color="#F1EFEA">
                    {formatTokens(total)}
                  </Text>
                  <Text size="caption" mono color="#AFB8B6">
                    {total > 0 && share === 0 ? '<1' : share}%
                  </Text>
                </Box>
                <Text color="#AFB8B6">{open === a.id ? '⌄' : '›'}</Text>
              </Box>
            ) : (
              <Box flexDirection="row" columnGap={2}>
                {figure(spriteOf(role, a.status), color)}
                <Box flexDirection="column" flexGrow={1} minWidth={0} justifyContent="center">
                  <Button
                    key={`agent-${a.id}`}
                    plain
                    label={a.label || a.type || a.id}
                    onPress={() => update($, expanded, x => (x === a.id ? null : a.id))}
                  />
                  <Text color={STATUS_COLOR[a.status]}>
                    {STATUS_GLYPH[a.status]} {STATUS_LABEL[a.status]}
                    {when}
                  </Text>
                  <Text color={VESUVIUS.ash} wrap="truncate-end">
                    {model}
                    {a.type && a.type !== 'main' ? ` · ${a.type}` : ''}
                  </Text>
                  <Box
                    flexDirection="row"
                    justifyContent="space-between"
                    flexWrap="wrap"
                    columnGap={2}
                  >
                    <Text>
                      <Text bold>{formatTokens(total)}</Text>{' '}
                      <Text color={VESUVIUS.ash}>{`${share}%`}</Text>
                    </Text>
                    <Text color={VESUVIUS.ash} wrap="truncate-end">
                      {a.steps} {a.steps === 1 ? 'richiesta' : 'richieste'} · {a.tools}{' '}
                      {a.tools === 1 ? 'strumento' : 'strumenti'}
                    </Text>
                  </Box>
                </Box>
              </Box>
            )}
            {a.id === open && (
              <Box flexDirection="column" marginTop={1} paddingX={1}>
                <Text bold>Registro agente</Text>
                {desktop && (
                  <Text size="footnote" color={VESUVIUS.ash}>
                    {a.type} · {a.steps} richieste · {a.tools} strumenti
                  </Text>
                )}
                {journal(entries.filter(entry => entry.agent === a.id).slice(0, 5))}
                <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                  {tile('INPUT', formatTokens(a.input), VESUVIUS.gulf)}
                  {tile('OUTPUT', formatTokens(a.output), VESUVIUS.vineyard)}
                  {tile('CACHE READ', formatTokens(a.cacheRead), VESUVIUS.sulfur)}
                  {tile('CACHE WRITE', formatTokens(a.cacheWrite), VESUVIUS.tuff)}
                  {tile('DURATA', formatDuration(a.durationMs))}
                </Box>
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
              <Text color={color}>{isOpen ? '▾' : '▸'}</Text>
              <Box
                flexDirection="row"
                flexGrow={1}
                justifyContent="space-between"
                flexWrap="wrap"
                columnGap={2}
              >
                <Box flexDirection="row" columnGap={1}>
                  <Button
                    key={`group-${g.role}`}
                    plain
                    label={`${g.agents.length === 1 ? one : many} ×${g.agents.length}`}
                    onPress={() => update($, openGroup, x => (x === g.role ? null : g.role))}
                  />
                  <Text color={VESUVIUS.ash} wrap="truncate-end">
                    {isOpen ? g.types.join(', ') : ''}
                    {g.failed > 0 ? ' · ' : ''}
                    {g.failed > 0 && <Text color={VESUVIUS.lava}>{g.failed} failed</Text>}
                  </Text>
                </Box>
                <Text>
                  <Text bold>{formatTokens(g.tokens)}</Text>{' '}
                  <Text color={VESUVIUS.ash}>{`${shareOf(g.tokens)}%`}</Text>
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
        <Box flexDirection="column" rowGap={desktop ? 'md' : 1} paddingX={desktop ? 'sm' : 0}>
          {heading}
          <Box {...card} flexDirection="column" rowGap={desktop ? 'xs' : 1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text size="heading" weight="semibold">
                In scena
              </Text>
              {desktop && (
                <Text size="footnote" mono color="#8ACBC7">
                  {running.length} al lavoro
                </Text>
              )}
            </Box>
            {stage.map(actor)}
          </Box>
          {archive.length > 0 && (
            <Box flexDirection="column">
              <Text size="heading" weight="semibold">
                Archivio
              </Text>
              {archive.map(shelf)}
            </Box>
          )}
          <Box flexDirection="row" justifyContent="space-between">
            {!desktop && <Text color={VESUVIUS.ash}>Seleziona un agente per il registro</Text>}
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
