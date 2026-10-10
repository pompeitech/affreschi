import type { Register, Timer } from 'claude-code'

import { VESUVIUS } from './vesuvius'

// Le parole dello spinner e della riga di fine turno, al posto di quelle di Claude Code.
const PAROLE: [string, ...string[]] = ['Ribollendo', 'Eruttando', 'Fumando', 'Brontolando', 'Sbuffando', 'Colando lava', 'Scaldando il magma']
const PASSATI: [string, ...string[]] = ['Eruttato', 'Ribollito', 'Fumato', 'Brontolato', 'Colato', 'Sbuffato']

// Il bagliore del cratere: un fotogramma per tick, colori alternati.
const FOTOGRAMMI = ['·', '∘', '○', '◎', '●', '◎', '○', '∘']
const TICK_MS = 140

export function durata(ms: number): string {
  const secondi = Math.max(0, Math.round(ms / 1000))
  const minuti = Math.floor(secondi / 60)

  return minuti > 0 ? `${minuti}m ${secondi % 60}s` : `${secondi}s`
}

export function scegli<T>(lista: readonly [T, ...T[]], seme: number): T {
  return lista[Math.abs(Math.floor(seme)) % lista.length] ?? lista[0]
}

export const register: Register = on => {
  // Valori del modulo: si azzerano a ogni ricarica, e va bene così.
  let fotogramma = 0
  let parola = PAROLE[0]
  let timer: Timer | undefined

  on('turn.start', async ($, e, next) => {
    parola = scegli(PAROLE, await $.clock.now())
    timer?.cancel()
    timer = $.clock.every(TICK_MS, () => {
      fotogramma = (fotogramma + 1) % FOTOGRAMMI.length
      $.ui.invalidate('ui.render')
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    timer?.cancel()
    timer = undefined

    return next(e)
  })

  // Lo spinner: nel terminale lo ridisegno io; sul desktop lascio quello di Claude Code,
  // che lì dice cosa sta facendo il passo ("Creating notes.md").
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const testo = e.props.message ?? parola
    const colore = fotogramma % 2 === 0 ? VESUVIUS.lava : VESUVIUS.magma

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text color={colore} bold>
          {FOTOGRAMMI[fotogramma]}
        </Text>
        <Text color={VESUVIUS.magma}>{testo}…</Text>
      </Box>
    )
  })

  // Ogni riga di tool call: la riga di Claude Code, con una colata di colore a sinistra.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    const loro = await next(e)
    const colore = e.props.isErrored
      ? VESUVIUS.lava
      : e.props.isRunning
        ? VESUVIUS.magma
        : VESUVIUS.cenere

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text color={colore}>▍</Text>
        {loro}
      </Box>
    )
  })

  // La riga che chiude il turno ("Baked for 3s") diventa un'eruzione.
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const passato = scegli(PASSATI, e.props.durationMs / 1000)

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text color={VESUVIUS.lava}>▲</Text>
        <Text color={VESUVIUS.tufo}>
          {passato} per {durata(e.props.durationMs)}
        </Text>
      </Box>
    )
  })
}
