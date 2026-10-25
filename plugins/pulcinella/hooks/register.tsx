import type { EngineInterface, Register, RenderElement } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { DetailItem, Face, Mood } from '../types'
import {
  alertColor,
  allocateCells,
  colorOf,
  fillOf,
  formatTokens,
  headroomColor,
  headroomOf,
  percentOf,
  pushTotal,
  toContextMap,
  turnsLeft
} from './context'
import { cellsOf, labelOf, levelOf, linesOf, quoteFor, spriteOf, svgOf } from './mascot'
import { VESUVIUS } from './palette'

const PANE = 'context-map'
// CSS pixels per sprite pixel where Pulcinella is drawn as an image.
const SVG_PIXEL = 6
// The animation's beat; away NAP_MS, he falls asleep; a cheer or a gasp fades after CALM_MS.
const TICK_MS = 500
const NAP_MS = 10 * 60 * 1000
const CALM_MS = 30 * 1000
// The context is read again at most this often while a turn runs.
const REFRESH_MS = 1500
// An edit or write of this many lines leaves him stunned.
const BIG_CHANGE_LINES = 300
// Categories the band names as chips; the rest fold into "+N".
const TOP_CHIPS = 4
const TOKENS_KEY = 'tokens'
const TEST_COMMAND = /\b(test|tests|vitest|jest|pytest|mocha|playwright|cargo test|go test)\b/

const CALM_FACE: Face = { mood: 'idle', quote: 'Pronto, comandate!' }
const NO_TOTALS: number[] = []

const face = atom({ plugin: 'pulcinella', key: 'face' } as const, CALM_FACE)
const tokens = atom({ plugin: 'pulcinella', key: 'tokens' } as const, 0)
const tick = atom({ plugin: 'pulcinella', key: 'tick' } as const, 0)
const map = atom({ plugin: 'pulcinella', key: 'map' } as const, null)
const isLegendHidden = atom({ plugin: 'pulcinella', key: 'isLegendHidden' } as const, false)
const totals = atom({ plugin: 'pulcinella', key: 'totals' } as const, NO_TOTALS)

// The module's own clock, in beats since it loaded, and when things last happened on it:
// a reload starts them over.
let beats = 0
let lastActivityAt = 0
let faceSetAt = 0
let lastRefreshAt = -Infinity

function now(): number {
  return beats * TICK_MS
}

// A failure the mod lives through (a read it retries on the next beat, a band beneath that did
// not draw) goes to the debug log, never silently away.
function logFailure($: EngineInterface, what: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  $.ui.log(`pulcinella: ${what} failed: ${reason}`, { to: 'debug' })
}

async function setFace($: EngineInterface, mood: Mood, what = ''): Promise<void> {
  const next: Face = { mood, quote: quoteFor(mood, what) }
  faceSetAt = now()
  await update($, face, () => next)
}

// Any sign of life wakes him and keeps him awake.
async function touch($: EngineInterface): Promise<void> {
  lastActivityAt = now()

  if ((await read($, face)).mood === 'sleeping') {
    await setFace($, 'idle')
  }
}

// One beat: he naps when you are away, calms down after a cheer, and moves to the next frame.
// The frame is written only when it changes, so an idle Pulcinella redraws twice per blink.
async function beat($: EngineInterface): Promise<void> {
  beats += 1
  const { mood } = await read($, face)

  if (mood !== 'sleeping' && now() - lastActivityAt >= NAP_MS) {
    return setFace($, 'sleeping')
  }

  if ((mood === 'happy' || mood === 'stunned') && now() - faceSetAt >= CALM_MS) {
    return setFace($, 'idle')
  }

  const frame =
    mood === 'working'
      ? beats
      : mood === 'idle'
        ? beats % 12 === 11
          ? 11
          : 0
        : Math.floor(beats / 2)

  if ((await read($, tick)) !== frame) {
    await update($, tick, () => frame)
  }
}

async function refresh($: EngineInterface, { isTurnEnd = false } = {}): Promise<void> {
  lastRefreshAt = now()
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown

  if (b === undefined) {
    return
  }

  const next = toContextMap(b)
  await update($, map, () => next)

  if (isTurnEnd) {
    await update($, totals, h => pushTotal(h, next.total))
  }
}

// The band beneath, when a plugin below drew one: an empty Box or nothing means none.
function hasContent(tree: RenderElement | null | undefined): tree is RenderElement {
  if (tree === null || tree === undefined) {
    return false
  }

  const children = 'children' in tree ? tree.children : undefined

  return !(
    tree.type === 'Box' &&
    (children === undefined || (Array.isArray(children) && children.length === 0))
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-map',
      description: 'Open the full context window breakdown',
      immediate: true
    })
    const spent = Number((await $.store.get(TOKENS_KEY)) ?? 0)
    await update($, tokens, () => (Number.isFinite(spent) ? spent : 0))
    await setFace($, 'idle')
    lastActivityAt = now()
    await refresh($).catch(error => logFailure($, 'reading the context', error))
    $.clock.every(TICK_MS, () => {
      beat($).catch(error => logFailure($, 'the animation beat', error))
    })

    return next(e)
  })

  on('command.run', { command: 'context-map' }, async $ => {
    await refresh($).catch(error => logFailure($, 'reading the context', error))
    await $.ui.open({ id: PANE, title: 'Context map', focus: true, closeOnEscape: true })

    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    await touch($)

    return next(e)
  })

  // Every tool call: he works while it runs, then frets, cheers or gasps at what came back.
  on('tool.call', async ($, e, next) => {
    await touch($)
    const before = (await read($, face)).mood

    // A fret or a cheer stays until the next one, rather than flickering back to work.
    if (before !== 'worried' && before !== 'happy') {
      await setFace($, 'working')
    }

    const result = await next(e)

    if (result.deny !== undefined) {
      return result
    }

    const command = e.tool === 'Bash' ? e.command : undefined
    const written = e.tool === 'Write' ? e.content : e.tool === 'Edit' ? e.new_string : ''

    if (result.isError === true) {
      await setFace($, 'worried', labelOf(String(e.tool), command))
    } else if (command !== undefined && TEST_COMMAND.test(command)) {
      await setFace($, 'happy')
    } else {
      const lines = linesOf(written)

      if (lines >= BIG_CHANGE_LINES) {
        await setFace($, 'stunned', `${lines} righe`)
      }
    }

    return result
  })

  // Every model request: its tokens grow his hat, and the main loop's refresh the context live.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage

    if (usage !== null) {
      const spent =
        usage.input_tokens +
        usage.output_tokens +
        usage.cache_read_input_tokens +
        usage.cache_creation_input_tokens
      await update($, tokens, t => t + spent)
    }

    if (e.agentId === undefined && now() - lastRefreshAt >= REFRESH_MS) {
      await refresh($).catch(error => logFailure($, 'reading the context', error))
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    lastActivityAt = now()

    if ((await read($, face)).mood === 'working') {
      await setFace($, 'idle')
    }

    await refresh($, { isTurnEnd: true }).catch(error =>
      logFailure($, 'reading the context', error)
    )
    await $.store.set(TOKENS_KEY, await read($, tokens))

    return result
  })

  // The band: Pulcinella, then the context beside him; a band a plugin beneath draws goes under.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const below = await next(e).catch(error => {
      logFailure($, 'drawing the band beneath', error)

      return null
    })
    const { Box, Text, Button } = $.ui.resolve(e)
    const { mood, quote } = await read($, face)
    const level = levelOf(await read($, tokens))
    const m = await read($, map)
    const pixels = spriteOf(mood, await read($, tick), level)
    const elements = $.ui.resolve(e)
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined

    // A graphical surface draws him as an image, pixel for pixel. The terminal draws two pixels
    // to a character, the glyph's color above and its background below, monospaced so the
    // columns line up.
    const pulcinella =
      Svg === undefined ? (
        <Box flexDirection="column" flexShrink={0} alignSelf="center">
          {cellsOf(pixels).map(row => (
            <Text mono>
              {row.map(cell =>
                cell.color === undefined ? (
                  cell.text
                ) : (
                  <Text color={cell.color} backgroundColor={cell.background}>
                    {cell.text}
                  </Text>
                )
              )}
            </Text>
          ))}
        </Box>
      ) : (
        <Box flexShrink={0} alignSelf="center">
          <Svg source={svgOf(pixels, SVG_PIXEL)} alt={`Pulcinella, ${mood}`} />
        </Box>
      )
    const says = (
      <Text color={VESUVIUS.tuff} italic wrap="truncate-end">
        “{quote}”
      </Text>
    )

    let side: RenderElement

    if (m === null || m.max <= 0) {
      side = (
        <Box flexDirection="column" flexGrow={1} justifyContent="center">
          {says}
          <Text color={VESUVIUS.ash}>livello {level}</Text>
        </Box>
      )
    } else {
      const isHidden = await read($, isLegendHidden)
      const headroom = headroomOf(m)
      const turns = turnsLeft(await read($, totals), headroom)
      // Cells only weigh the segments: the bar is boxes that grow by their share of the row.
      const cells = allocateCells(m.segments, m.max, 1000)
      const used = m.segments.flatMap((s, i) =>
        s.kind === 'used' && s.tokens > 0 ? [{ s, i }] : []
      )
      const chips = [...used].sort((a, b) => b.s.tokens - a.s.tokens).slice(0, TOP_CHIPS)
      const folded = used.length - chips.length

      side = (
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          borderColor={VESUVIUS.ash}
          paddingX={1}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Text>
              <Text color={VESUVIUS.lava}>◆</Text> <Text bold>context</Text>{' '}
              <Text color={VESUVIUS.ash}>
                · {formatTokens(m.max)} · {m.percent}% · livello {level}
              </Text>
            </Text>
            <Box flexDirection="row" columnGap={1}>
              <Button
                key="legend"
                plain
                label={isHidden ? 'legend' : 'hide'}
                onPress={() => update($, isLegendHidden, v => !v)}
              />
              <Button
                key="details"
                plain
                label="details"
                onPress={() =>
                  $.ui.open({ id: PANE, title: 'Context map', focus: true, closeOnEscape: true })
                }
              />
            </Box>
          </Box>
          <Box flexDirection="row" alignItems="flex-end" columnGap={4}>
            <Box flexDirection="column">
              <Text color={VESUVIUS.ash}>used</Text>
              <Text bold>{formatTokens(m.total)}</Text>
            </Box>
            <Box flexDirection="column">
              <Text color={VESUVIUS.ash}>
                {m.autoCompactThreshold !== null ? 'before compaction' : 'free'}
              </Text>
              <Text color={headroomColor(m)} bold>
                {formatTokens(headroom)}
              </Text>
            </Box>
            <Box flexGrow={1} />
            {turns !== null && (
              <Text color={VESUVIUS.ash}>≈ {turns} turns at the current pace</Text>
            )}
          </Box>
          {/* One row whatever the surface: each segment is a filled box that grows by its share,
              so nothing can wrap where a graphical surface's cells are not bodyColumns'. */}
          <Box flexDirection="row" height={1}>
            {m.segments.map((s, i) =>
              (cells[i] ?? 0) > 0 ? (
                <Box
                  key={s.name}
                  width={0}
                  flexGrow={cells[i]}
                  height={1}
                  backgroundColor={fillOf(m.segments, i)}
                >
                  <Text> </Text>
                </Box>
              ) : null
            )}
          </Box>
          {!isHidden && (
            <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
              {chips.map(({ s, i }) => (
                <Text key={s.name}>
                  <Text color={colorOf(m.segments, i)}>■</Text>{' '}
                  <Text color={VESUVIUS.ash}>{s.name.toLowerCase()}</Text>{' '}
                  <Text bold>{formatTokens(s.tokens)}</Text>
                </Text>
              ))}
              {folded > 0 && <Text color={VESUVIUS.ash}>+{folded} more</Text>}
            </Box>
          )}
          {says}
        </Box>
      )
    }

    const band = (
      <Box flexDirection="row" columnGap={2}>
        {pulcinella}
        {side}
      </Box>
    )

    return hasContent(below) ? (
      <Box flexDirection="column">
        {band}
        {below}
      </Box>
    ) : (
      band
    )
  })

  // The pane: every category with its share, then what fills the biggest ones.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const m = await read($, map)

    if (m === null || m.max <= 0) {
      return <Text color={VESUVIUS.ash}>No context data yet: it shows after the first answer.</Text>
    }

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
              {item.name} <Text color={VESUVIUS.ash}>{item.note}</Text>{' '}
              <Text color={VESUVIUS.magma}>{formatTokens(item.tokens)}</Text>
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
            const share = m.max > 0 ? (s.tokens / m.max) * 100 : 0

            return (
              <Box flexDirection="row" columnGap={1}>
                {/* Monospaced, so the names and numbers line up in columns on every surface. */}
                <Text mono>
                  <Text color={fillOf(m.segments, i)}>■</Text> {s.name.padEnd(nameWidth)}{' '}
                  <Text color={VESUVIUS.ash}>{formatTokens(s.tokens).padStart(6)}</Text>{' '}
                  <Text color={VESUVIUS.tuff}>{percentOf(s.tokens, m.max).padStart(4)}</Text>
                </Text>
                <Box flexDirection="row" flexGrow={1} height={1}>
                  <Box
                    width={`${Math.max(s.tokens > 0 ? 1 : 0, Math.round(share))}%`}
                    height={1}
                    backgroundColor={fillOf(m.segments, i)}
                  >
                    <Text> </Text>
                  </Box>
                </Box>
              </Box>
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
