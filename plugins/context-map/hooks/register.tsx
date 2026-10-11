import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextBreakdown } from 'claude-code'

import type { ContextMap, DetailItem, Segment } from '../types'
import { SEQUENCE, VESUVIUS } from './palette'

const PANE = 'context-map'
const TOP_ITEMS = 8

const map = atom({ plugin: 'context-map', key: 'map' } as const, null)
const isLegendHidden = atom({ plugin: 'context-map', key: 'isLegendHidden' } as const, false)

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`

  return String(n)
}

export function percentOf(tokens: number, max: number): string {
  if (max <= 0) return '0%'
  const p = (tokens / max) * 100

  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`
}

// How many cells of the bar each segment gets: any segment with tokens gets at least one,
// and the total never exceeds the width.
export function allocateCells(segments: readonly Segment[], max: number, width: number): number[] {
  const cells = segments.map(s => {
    const t = s.kind === 'deferred' || max <= 0 ? 0 : s.tokens

    return t > 0 ? Math.max(1, Math.round((t / max) * width)) : 0
  })
  let excess = cells.reduce((a, b) => a + b, 0) - width

  // On overflow, take from the free space first, then from the largest shares.
  segments.forEach((s, i) => {
    const c = cells[i] ?? 0
    if (excess > 0 && s.kind === 'free') {
      const cut = Math.min(excess, c)
      cells[i] = c - cut
      excess -= cut
    }
  })
  while (excess > 0) {
    const largest = Math.max(...cells)
    if (largest <= 1) break
    const i = cells.indexOf(largest)
    cells[i] = largest - 1
    excess -= 1
  }

  return cells
}

export function colorOf(segments: readonly Segment[], i: number): string {
  const s = segments[i]
  if (s === undefined || s.kind !== 'used') return VESUVIUS.ash
  const usedBefore = segments.slice(0, i).filter(x => x.kind === 'used').length

  return SEQUENCE[usedBefore % SEQUENCE.length] ?? VESUVIUS.lava
}

export function glyphOf(kind: Segment['kind']): string {
  return kind === 'used' ? '█' : kind === 'buffer' ? '▒' : '░'
}

export function alertColor(percent: number): string {
  return percent >= 85 ? VESUVIUS.lava : percent >= 60 ? VESUVIUS.magma : VESUVIUS.tuff
}

function top(items: DetailItem[]): DetailItem[] {
  return [...items].sort((a, b) => b.tokens - a.tokens).slice(0, TOP_ITEMS)
}

// Shortens a path to its last two parts: ~/.claude/CLAUDE.md → .claude/CLAUDE.md
export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)

  return parts.length <= 2 ? path : parts.slice(-2).join('/')
}

// Turns /context's breakdown into what the band and the pane draw.
export function toContextMap(b: SessionContextBreakdown): ContextMap {
  const servers = new Map<string, { tokens: number; tools: number; loaded: number }>()
  for (const tool of b.mcpTools) {
    const s = servers.get(tool.serverName) ?? { tokens: 0, tools: 0, loaded: 0 }
    s.tokens += tool.tokens
    s.tools += 1
    if (tool.isLoaded) s.loaded += 1
    servers.set(tool.serverName, s)
  }

  return {
    percent: b.percentage,
    total: b.totalTokens,
    max: b.rawMaxTokens,
    model: b.model,
    autoCompactThreshold: b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null,
    // What is used first, then the compaction reserve, then the free space.
    segments: [
      ...b.categories.filter(c => c.kind === 'used'),
      ...b.categories.filter(c => c.kind === 'buffer'),
      ...b.categories.filter(c => c.kind === 'free'),
    ].map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
    memoryFiles: top(b.memoryFiles.map(f => ({ name: shortPath(f.path), note: f.type, tokens: f.tokens }))),
    mcpServers: top(
      [...servers].map(([name, s]) => ({
        name,
        note: `${s.loaded}/${s.tools} tools loaded`,
        tokens: s.tokens,
      })),
    ),
    agents: top(b.agents.map(a => ({ name: a.agentType, note: a.source, tokens: a.tokens }))),
    skills: top((b.skills?.skillFrontmatter ?? []).map(s => ({ name: s.name, note: s.pluginName ?? s.source, tokens: s.tokens }))),
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (b === undefined) return

  const next = toContextMap(b)
  await update($, map, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-map',
      description: 'Open the full context window breakdown',
      immediate: true,
    })
    await refresh($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'context-map' }, async $ => {
    await refresh($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: 'Context map', focus: true, closeOnEscape: true })

    return {}
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($).catch(() => undefined)

    return result
  })

  // The band: the bar, then a legend that is always there until hidden.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, map)
    if (e.props.hasSurvey || m === null || m.max <= 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const isHidden = await read($, isLegendHidden)
    const width = Math.max(10, Math.min(60, e.props.bodyColumns - 40))
    const cells = allocateCells(m.segments, m.max, width)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text color={VESUVIUS.lava}>▲</Text>
          <Text>
            {m.segments.map((s, i) => (
              <Text color={colorOf(m.segments, i)} dimColor={s.kind === 'free'}>
                {glyphOf(s.kind).repeat(cells[i] ?? 0)}
              </Text>
            ))}
          </Text>
          <Text color={alertColor(m.percent)} bold={m.percent >= 85}>
            {m.percent}%
          </Text>
          <Text color={VESUVIUS.ash}>
            {formatTokens(m.total)}/{formatTokens(m.max)}
          </Text>
          <Button
            key="legend"
            plain
            label={isHidden ? 'legend' : 'hide'}
            onPress={() => update($, isLegendHidden, v => !v)}
          />
          <Button key="details" plain label="details" onPress={() => $.ui.open({ id: PANE, title: 'Context map', focus: true, closeOnEscape: true })} />
        </Box>
        {!isHidden && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2}>
            {m.segments.map((s, i) => (
              <Text>
                <Text color={colorOf(m.segments, i)} dimColor={s.kind === 'free'}>
                  {glyphOf(s.kind)}
                </Text>{' '}
                {s.name} <Text color={VESUVIUS.ash}>{formatTokens(s.tokens)}</Text>
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  // The pane: every category with its share, then what fills the biggest ones.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const m = await read($, map)
    if (m === null || m.max <= 0) {
      return <Text color={VESUVIUS.ash}>No context data yet: it shows after the first answer.</Text>
    }

    const width = Math.max(10, Math.min(40, e.props.bodyColumns - 36))
    const nameWidth = Math.max(...m.segments.map(s => s.name.length), 12)

    const section = (title: string, items: DetailItem[]) =>
      items.length > 0 && (
        <Box flexDirection="column">
          <Text color={VESUVIUS.tuff} bold>
            {title}
          </Text>
          {items.map(item => (
            <Text wrap="truncate-end">
              {'  '}
              {item.name} <Text color={VESUVIUS.ash}>{item.note}</Text> <Text color={VESUVIUS.magma}>{formatTokens(item.tokens)}</Text>
            </Text>
          ))}
        </Box>
      )

    return (
      <Box flexDirection="column" rowGap={1}>
        <Text>
          <Text color={alertColor(m.percent)} bold>
            {m.percent}%
          </Text>{' '}
          of {formatTokens(m.max)} · <Text color={VESUVIUS.ash}>{m.model}</Text>
          {m.autoCompactThreshold !== null ? (
            <Text color={VESUVIUS.ash}> · compacts at {formatTokens(m.autoCompactThreshold)}</Text>
          ) : (
            ''
          )}
        </Text>
        <Box flexDirection="column">
          {m.segments.map((s, i) => {
            const cells = Math.max(s.tokens > 0 ? 1 : 0, Math.round((s.tokens / m.max) * width))

            return (
              <Text>
                <Text color={colorOf(m.segments, i)} dimColor={s.kind === 'free'}>
                  {glyphOf(s.kind)}
                </Text>{' '}
                {s.name.padEnd(nameWidth)} <Text color={VESUVIUS.ash}>{formatTokens(s.tokens).padStart(6)}</Text>{' '}
                <Text color={VESUVIUS.tuff}>{percentOf(s.tokens, m.max).padStart(4)}</Text>{' '}
                <Text color={colorOf(m.segments, i)} dimColor={s.kind === 'free'}>
                  {glyphOf(s.kind).repeat(cells)}
                </Text>
              </Text>
            )
          })}
        </Box>
        {section('Memory files', m.memoryFiles)}
        {section('MCP servers', m.mcpServers)}
        {section('Custom agents', m.agents)}
        {section('Skills', m.skills)}
      </Box>
    )
  })
}
