import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextMap, Segment } from '../types'
import { SEQUENCE, VESUVIUS } from './palette'

const map = atom({ plugin: 'context-map', key: 'map' } as const, null)
const isExpanded = atom({ plugin: 'context-map', key: 'isExpanded' } as const, false)

export function formatTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
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

export function alertColor(percent: number): string {
  return percent >= 85 ? VESUVIUS.lava : percent >= 60 ? VESUVIUS.magma : VESUVIUS.tuff
}

async function refresh($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (b === undefined) return

  const next: ContextMap = {
    percent: b.percentage,
    total: b.totalTokens,
    max: b.rawMaxTokens,
    // What is used first, then the compaction reserve, then the free space.
    segments: [
      ...b.categories.filter(c => c.kind === 'used'),
      ...b.categories.filter(c => c.kind === 'buffer'),
      ...b.categories.filter(c => c.kind === 'free'),
    ].map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
  }
  await update($, map, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($).catch(() => undefined)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, map)
    if (e.props.hasSurvey || m === null || m.max <= 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const isOpen = await read($, isExpanded)
    const width = Math.max(10, Math.min(60, e.props.bodyColumns - 30))
    const cells = allocateCells(m.segments, m.max, width)
    const used = m.segments.filter(s => s.kind === 'used')

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text color={VESUVIUS.lava}>▲</Text>
          <Text>
            {m.segments.map((s, i) => (
              <Text color={colorOf(m.segments, i)} dimColor={s.kind === 'free'}>
                {(s.kind === 'used' ? '█' : s.kind === 'buffer' ? '▒' : '░').repeat(cells[i] ?? 0)}
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
            key="details"
            plain
            label={isOpen ? 'close' : 'details'}
            onPress={() => update($, isExpanded, v => !v)}
          />
        </Box>
        {isOpen &&
          used.map(s => (
            <Text>
              {'  '}
              <Text color={colorOf(m.segments, m.segments.indexOf(s))}>■</Text> {s.name}{' '}
              <Text color={VESUVIUS.ash}>
                {formatTokens(s.tokens)} · {Math.round((s.tokens / m.max) * 100)}%
              </Text>
            </Text>
          ))}
      </Box>
    )
  })
}
