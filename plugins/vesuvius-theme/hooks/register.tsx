import type { Register, Timer } from 'claude-code'

import { VESUVIUS } from './palette'

// The words for the spinner and the end-of-turn line, in place of Claude Code's.
const WORDS: [string, ...string[]] = ['Bubbling', 'Erupting', 'Smoking', 'Rumbling', 'Venting', 'Flowing', 'Heating the magma']
const PAST_WORDS: [string, ...string[]] = ['Erupted', 'Bubbled', 'Smoked', 'Rumbled', 'Flowed', 'Vented']

// The crater's glow: one frame per tick, alternating colors.
const FRAMES = ['·', '∘', '○', '◎', '●', '◎', '○', '∘']
const TICK_MS = 140

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)

  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

export function pick<T>(list: readonly [T, ...T[]], seed: number): T {
  return list[Math.abs(Math.floor(seed)) % list.length] ?? list[0]
}

export const register: Register = on => {
  // Module values: they reset on every reload, which is fine here.
  let frame = 0
  let word = WORDS[0]
  let timer: Timer | undefined

  on('turn.start', async ($, e, next) => {
    word = pick(WORDS, await $.clock.now())
    timer?.cancel()
    timer = $.clock.every(TICK_MS, () => {
      frame = (frame + 1) % FRAMES.length
      $.ui.invalidate('ui.render')
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    timer?.cancel()
    timer = undefined

    return next(e)
  })

  // The spinner: redrawn in the terminal; on the desktop Claude Code's own stays,
  // since there it says what the step is doing ("Creating notes.md").
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const text = e.props.message ?? word
    const color = frame % 2 === 0 ? VESUVIUS.lava : VESUVIUS.magma

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text color={color} bold>
          {FRAMES[frame]}
        </Text>
        <Text color={VESUVIUS.magma}>{text}…</Text>
      </Box>
    )
  })

  // Every tool call row: Claude Code's row, with a stripe of color on its left.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    const color = e.props.isErrored
      ? VESUVIUS.lava
      : e.props.isRunning
        ? VESUVIUS.magma
        : VESUVIUS.ash

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text color={color}>▍</Text>
        {theirs}
      </Box>
    )
  })

  // The line that closes a turn ("Baked for 3s") becomes an eruption.
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const past = pick(PAST_WORDS, e.props.durationMs / 1000)

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text color={VESUVIUS.lava}>▲</Text>
        <Text color={VESUVIUS.tuff}>
          {past} for {formatDuration(e.props.durationMs)}
        </Text>
      </Box>
    )
  })
}
