import type { SessionContextBreakdown } from 'claude-code'

import type { ContextMap, DetailItem, Segment } from '../types'
import { SEQUENCE, VESUVIUS } from './palette'

// The context window's numbers: what the band and the details pane draw, from /context's breakdown.

const TOP_ITEMS = 8
// Turns the pace estimate averages over.
const PACE_TURNS = 5
const FREE_FILL = '#3A3836'
const BUFFER_FILL = '#5C5955'

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

export function percentOf(tokens: number, max: number): string {
  if (max <= 0) {
    return '0%'
  }

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

    if (largest <= 1) {
      break
    }

    const i = cells.indexOf(largest)
    cells[i] = largest - 1
    excess -= 1
  }

  return cells
}

export function colorOf(segments: readonly Segment[], i: number): string {
  const s = segments[i]

  if (s === undefined || s.kind !== 'used') {
    return VESUVIUS.ash
  }

  const usedBefore = segments.slice(0, i).filter(x => x.kind === 'used').length

  return SEQUENCE[usedBefore % SEQUENCE.length] ?? VESUVIUS.lava
}

// The bar's fill: the category's color for what is used, greys for the reserve and the free space.
export function fillOf(segments: readonly Segment[], i: number): string {
  const kind = segments[i]?.kind

  if (kind === 'free') {
    return FREE_FILL
  }

  if (kind === 'buffer') {
    return BUFFER_FILL
  }

  return colorOf(segments, i)
}

export function glyphOf(kind: Segment['kind']): string {
  return kind === 'used' ? '█' : kind === 'buffer' ? '▒' : '░'
}

export function alertColor(percent: number): string {
  return percent >= 85 ? VESUVIUS.lava : percent >= 60 ? VESUVIUS.magma : VESUVIUS.tuff
}

// Tokens left before the context compacts, or before it is full when it never does.
export function headroomOf(m: ContextMap): number {
  return Math.max(0, (m.autoCompactThreshold ?? m.max) - m.total)
}

export function headroomColor(m: ContextMap): string {
  const limit = m.autoCompactThreshold ?? m.max
  const used = limit > 0 ? (m.total / limit) * 100 : 100

  return used >= 85 ? VESUVIUS.lava : used >= 60 ? VESUVIUS.magma : VESUVIUS.vineyard
}

// Adds a turn's total to the recent ones; a total that shrank (a compaction, a clear) starts over.
export function pushTotal(history: readonly number[], total: number): number[] {
  const last = history[history.length - 1]

  if (last !== undefined && total < last) {
    return [total]
  }

  return [...history, total].slice(-(PACE_TURNS + 1))
}

// How many more turns fit in the headroom at the recent average growth per turn, or null
// before there are two turns to compare or while the context is not growing.
export function turnsLeft(history: readonly number[], headroom: number): number | null {
  if (history.length < 2) {
    return null
  }

  const first = history[0] ?? 0
  const last = history[history.length - 1] ?? 0
  const pace = (last - first) / (history.length - 1)

  return pace > 0 ? Math.floor(headroom / pace) : null
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

    if (tool.isLoaded) {
      s.loaded += 1
    }

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
      ...b.categories.filter(c => c.kind === 'free')
    ].map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
    memoryFiles: top(
      b.memoryFiles.map(f => ({ name: shortPath(f.path), note: f.type, tokens: f.tokens }))
    ),
    mcpServers: top(
      [...servers].map(([name, s]) => ({
        name,
        note: `${s.loaded}/${s.tools} tools loaded`,
        tokens: s.tokens
      }))
    ),
    agents: top(b.agents.map(a => ({ name: a.agentType, note: a.source, tokens: a.tokens }))),
    skills: top(
      (b.skills?.skillFrontmatter ?? []).map(s => ({
        name: s.name,
        note: s.pluginName ?? s.source,
        tokens: s.tokens
      }))
    )
  }
}
