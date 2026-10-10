import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mappa, Segmento } from '../types'
import { SEQUENZA, VESUVIUS } from './vesuvius'

const mappa = atom({ plugin: 'mappa-contesto', key: 'mappa' } as const, null)
const isExpanded = atom({ plugin: 'mappa-contesto', key: 'isExpanded' } as const, false)

export function k(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

// Quante celle della barra spettano a ogni segmento: chi ha token ne ha almeno una,
// e la somma non supera mai la larghezza.
export function celle(segments: readonly Segmento[], max: number, larghezza: number): number[] {
  const quote = segments.map(s => {
    const t = s.kind === 'deferred' || max <= 0 ? 0 : s.tokens

    return t > 0 ? Math.max(1, Math.round((t / max) * larghezza)) : 0
  })
  let eccesso = quote.reduce((a, b) => a + b, 0) - larghezza

  // Se si sfora, si toglie prima dallo spazio libero, poi dalle quote più grandi.
  segments.forEach((s, i) => {
    const q = quote[i] ?? 0
    if (eccesso > 0 && s.kind === 'free') {
      const via = Math.min(eccesso, q)
      quote[i] = q - via
      eccesso -= via
    }
  })
  while (eccesso > 0) {
    const piuGrande = Math.max(...quote)
    if (piuGrande <= 1) break
    const i = quote.indexOf(piuGrande)
    quote[i] = piuGrande - 1
    eccesso -= 1
  }

  return quote
}

export function coloreDi(segments: readonly Segmento[], i: number): string {
  const s = segments[i]
  if (s === undefined || s.kind !== 'used') return VESUVIUS.cenere
  const usati = segments.slice(0, i).filter(x => x.kind === 'used').length

  return SEQUENZA[usati % SEQUENZA.length] ?? VESUVIUS.lava
}

export function allerta(percent: number): string {
  return percent >= 85 ? VESUVIUS.lava : percent >= 60 ? VESUVIUS.magma : VESUVIUS.tufo
}

async function aggiorna($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (b === undefined) return

  const nuova: Mappa = {
    percent: b.percentage,
    total: b.totalTokens,
    max: b.rawMaxTokens,
    // Prima ciò che occupa, poi la riserva per la compattazione, infine lo spazio libero.
    segments: [
      ...b.categories.filter(c => c.kind === 'used'),
      ...b.categories.filter(c => c.kind === 'buffer'),
      ...b.categories.filter(c => c.kind === 'free'),
    ].map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
  }
  await update($, mappa, () => nuova)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await aggiorna($).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await aggiorna($).catch(() => undefined)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, mappa)
    if (e.props.hasSurvey || m === null || m.max <= 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const aperto = await read($, isExpanded)
    const larghezza = Math.max(10, Math.min(60, e.props.bodyColumns - 30))
    const quote = celle(m.segments, m.max, larghezza)
    const usati = m.segments.filter(s => s.kind === 'used')

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text color={VESUVIUS.lava}>▲</Text>
          <Text>
            {m.segments.map((s, i) => (
              <Text color={coloreDi(m.segments, i)} dimColor={s.kind === 'free'}>
                {(s.kind === 'used' ? '█' : s.kind === 'buffer' ? '▒' : '░').repeat(quote[i] ?? 0)}
              </Text>
            ))}
          </Text>
          <Text color={allerta(m.percent)} bold={m.percent >= 85}>
            {m.percent}%
          </Text>
          <Text color={VESUVIUS.cenere}>
            {k(m.total)}/{k(m.max)}
          </Text>
          <Button
            key="dettagli"
            plain
            label={aperto ? 'chiudi' : 'dettagli'}
            onPress={() => update($, isExpanded, v => !v)}
          />
        </Box>
        {aperto &&
          usati.map(s => (
            <Text>
              {'  '}
              <Text color={coloreDi(m.segments, m.segments.indexOf(s))}>■</Text> {s.name}{' '}
              <Text color={VESUVIUS.cenere}>
                {k(s.tokens)} · {Math.round((s.tokens / m.max) * 100)}%
              </Text>
            </Text>
          ))}
      </Box>
    )
  })
}
