import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { AgentUsage } from '../types'
import { SEQUENCE, VESUVIUS } from './palette'

const PANE = 'agent-usage'
export const MAIN = 'main'

const agents = atom({ plugin: 'agent-usage', key: 'agents' } as const, [])
const expanded = atom({ plugin: 'agent-usage', key: 'expanded' } as const, null)
const costUsd = atom({ plugin: 'agent-usage', key: 'costUsd' } as const, null)

export function emptyUsage(id: string, label: string, type: string): AgentUsage {
  return { id, label, type, model: '', status: 'running', steps: 0, tools: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, durationMs: null }
}

export function totalOf(a: AgentUsage): number {
  return a.input + a.output + a.cacheRead + a.cacheWrite
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`

  return String(n)
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
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
  fallback: () => AgentUsage,
): AgentUsage[] {
  const found = list.find(a => a.id === id)

  return found === undefined ? [...list, change(fallback())] : list.map(a => (a.id === id ? change(a) : a))
}

export function addUsage(a: AgentUsage, usage: ModelUsage & { model?: string }): AgentUsage {
  return {
    ...a,
    model: usage.model ?? a.model,
    steps: a.steps + 1,
    input: a.input + usage.input_tokens,
    output: a.output + usage.output_tokens,
    cacheRead: a.cacheRead + usage.cache_read_input_tokens,
    cacheWrite: a.cacheWrite + usage.cache_creation_input_tokens,
  }
}

// The main conversation first, then the subagents, biggest first.
export function sorted(list: readonly AgentUsage[]): AgentUsage[] {
  return [...list].sort((a, b) => (a.id === MAIN ? -1 : b.id === MAIN ? 1 : totalOf(b) - totalOf(a)))
}

const STATUS_GLYPH: Record<AgentUsage['status'], string> = {
  pending: '◌',
  running: '●',
  waiting: '◐',
  idle: '○',
  completed: '✓',
  failed: '✗',
  killed: '✗',
}

function statusColor(status: AgentUsage['status']): string {
  if (status === 'running' || status === 'waiting') return VESUVIUS.magma
  if (status === 'failed' || status === 'killed') return VESUVIUS.lava
  if (status === 'completed') return VESUVIUS.vineyard

  return VESUVIUS.ash
}

const mainRow = () => ({ ...emptyUsage(MAIN, 'Main conversation', 'main'), status: 'idle' as const })

// Reads the agents' status and cost from the engine.
async function refresh($: EngineInterface): Promise<void> {
  const known = await $.agent.list().catch(() => [])
  const usage = await $.session.usage().catch(() => undefined)
  await update($, agents, list =>
    list.map(a => {
      const info = known.find(k => k.id === a.id)

      return info === undefined ? a : { ...a, status: info.status, label: a.label || info.description, type: a.type || info.type }
    }),
  )
  await update($, costUsd, () => usage?.cost?.usd ?? null)
}

// The status line while subagents run: how many, and what they consumed so far.
async function showStatus($: EngineInterface): Promise<void> {
  const list = await read($, agents)
  const running = list.filter(a => a.id !== MAIN && (a.status === 'running' || a.status === 'waiting'))
  if (running.length === 0) {
    $.ui.status(undefined)

    return
  }
  const tokens = running.reduce((sum, a) => sum + totalOf(a), 0)
  $.ui.status(`▲ ${running.length} ${running.length === 1 ? 'agent' : 'agents'} running · ${formatTokens(tokens)} tokens`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-usage',
      description: 'Open the pane with the tokens each agent consumed',
      immediate: true,
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
          a => ({ ...a, label: e.description, type: e.subagentType, model: result.model, status: 'running' }),
          () => emptyUsage(id, e.description, e.subagentType),
        ),
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
        upsert(list, id, a => addUsage(a, usage), () => (id === MAIN ? mainRow() : emptyUsage(id, '', ''))),
      )
      await showStatus($)
    }

    return result
  })

  // Every tool call counts for the loop it runs in.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    await update($, agents, list =>
      upsert(list, id, a => ({ ...a, tools: a.tools + 1 }), () => (id === MAIN ? mainRow() : emptyUsage(id, '', ''))),
    )

    return next(e)
  })

  // A foreground subagent ends: its Agent call reports how long it ran.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    const result = ran.result as { status?: string; agentId?: string; totalDurationMs?: number } | undefined
    if (result?.status === 'completed' && result.agentId !== undefined) {
      const id = result.agentId
      const finished = (await read($, agents)).find(a => a.id === id)
      await update($, agents, list =>
        list.map(a => (a.id === id ? { ...a, status: 'completed', durationMs: result.totalDurationMs ?? a.durationMs } : a)),
      )
      if (finished !== undefined) {
        $.ui.toast(`✓ ${finished.label || finished.type} · ${formatTokens(totalOf(finished))} tokens`)
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
    const list = sorted(await read($, agents))
    const open = await read($, expanded)
    const cost = await read($, costUsd)

    if (list.length === 0) {
      return <Text color={VESUVIUS.ash}>No model requests yet.</Text>
    }

    const grand = list.reduce((sum, a) => sum + totalOf(a), 0)
    const subagents = list.filter(a => a.id !== MAIN)
    const barWidth = Math.max(6, Math.min(24, e.props.bodyColumns - 60))
    const labelWidth = Math.max(12, Math.min(28, e.props.bodyColumns - barWidth - 34))

    return (
      <Box flexDirection="column" rowGap={1}>
        <Text>
          <Text color={VESUVIUS.lava}>▲</Text> <Text bold>{formatTokens(grand)}</Text> tokens ·{' '}
          <Text color={VESUVIUS.tuff}>
            {subagents.length} {subagents.length === 1 ? 'subagent' : 'subagents'}
          </Text>
          {cost !== null ? <Text color={VESUVIUS.ash}> · session cost ${cost.toFixed(2)}</Text> : ''}
        </Text>
        <Box flexDirection="column">
          {list.map((a, i) => {
            const total = totalOf(a)
            const share = grand > 0 ? total / grand : 0
            const cells = total > 0 ? Math.max(1, Math.round(share * barWidth)) : 0
            const color = SEQUENCE[i % SEQUENCE.length] ?? VESUVIUS.lava
            const name = (a.label || a.type || a.id).slice(0, labelWidth).padEnd(labelWidth)

            return (
              <Box flexDirection="column">
                <Button key={`agent-${a.id}`} plain onPress={() => update($, expanded, x => (x === a.id ? null : a.id))}>
                  <Text color={statusColor(a.status)}>{STATUS_GLYPH[a.status]}</Text> <Text bold={a.id === open}>{name}</Text>{' '}
                  <Text color={VESUVIUS.magma}>{formatTokens(total).padStart(6)}</Text>{' '}
                  <Text color={VESUVIUS.tuff}>{`${Math.round(share * 100)}%`.padStart(4)}</Text> <Text color={color}>{'█'.repeat(cells)}</Text>
                  <Text color={VESUVIUS.ash}>{'░'.repeat(Math.max(0, barWidth - cells))}</Text>
                </Button>
                {a.id === open && (
                  <Box flexDirection="column" paddingLeft={2}>
                    <Text color={VESUVIUS.ash}>
                      {a.type !== 'main' ? `${a.type} · ` : ''}
                      {a.model ? shortModel(a.model) : 'model unknown'} · {a.status} · ran {formatDuration(a.durationMs)}
                    </Text>
                    <Text>
                      <Text color={VESUVIUS.gulf}>in</Text> {formatTokens(a.input)} · <Text color={VESUVIUS.vineyard}>out</Text> {formatTokens(a.output)} ·{' '}
                      <Text color={VESUVIUS.sulfur}>cache read</Text> {formatTokens(a.cacheRead)} · <Text color={VESUVIUS.tuff}>cache write</Text>{' '}
                      {formatTokens(a.cacheWrite)}
                    </Text>
                    <Text color={VESUVIUS.ash}>
                      {a.steps} {a.steps === 1 ? 'request' : 'requests'} · {a.tools} tool {a.tools === 1 ? 'call' : 'calls'}
                    </Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
        <Box flexDirection="row" columnGap={2}>
          <Text color={VESUVIUS.ash}>● running ◐ waiting ✓ done ✗ failed · press a row for details</Text>
          <Button key="reset" plain label="reset" onPress={() => update($, agents, () => [])} />
        </Box>
      </Box>
    )
  })
}
