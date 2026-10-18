import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { TouchedFile } from '../types'
import { VESUVIUS } from './palette'

const PANE = 'touched-files'
const DIFF_MAX = 40_000

const files = atom({ plugin: 'touched-files', key: 'files' } as const, [])
const selected = atom({ plugin: 'touched-files', key: 'selected' } as const, null)
// True once a turn has ended: the next touch belongs to a new turn and starts the list over.
const isStale = atom({ plugin: 'touched-files', key: 'isStale' } as const, false)

type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

function isHunk(value: unknown): value is Hunk {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const h: Partial<Record<keyof Hunk, unknown>> = value

  return (
    typeof h.oldStart === 'number' &&
    typeof h.oldLines === 'number' &&
    typeof h.newStart === 'number' &&
    typeof h.newLines === 'number' &&
    Array.isArray(h.lines) &&
    h.lines.every(line => typeof line === 'string')
  )
}

// The structured patch an edit tool's result carries, checked hunk by hunk; none when absent.
export function patchOf(result: unknown): Hunk[] {
  if (typeof result !== 'object' || result === null || !('structuredPatch' in result)) {
    return []
  }

  const patch = result.structuredPatch

  return Array.isArray(patch) ? patch.filter(isHunk) : []
}

// Turns Edit/Write's structured patch into unified hunks that `Code` can draw.
export function toHunks(patch: readonly Hunk[]): { diff: string; added: number; removed: number } {
  let added = 0
  let removed = 0
  const parts = patch.map(h => {
    for (const line of h.lines) {
      if (line.startsWith('+')) {
        added += 1
      } else if (line.startsWith('-')) {
        removed += 1
      }
    }

    return [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join(
      '\n'
    )
  })

  return { diff: parts.join('\n'), added, removed }
}

// Adds or updates a file, moving it to the top of the list.
export function recordTouch(
  list: readonly TouchedFile[],
  touch: Partial<TouchedFile> & { path: string }
): TouchedFile[] {
  const before = list.find(f => f.path === touch.path)
  const base: TouchedFile = before ?? {
    path: touch.path,
    isRead: false,
    isEdited: false,
    added: 0,
    removed: 0,
    diff: ''
  }

  const diff = touch.diff ? [base.diff, touch.diff].filter(Boolean).join('\n') : base.diff
  const next: TouchedFile = {
    path: touch.path,
    isRead: base.isRead || Boolean(touch.isRead),
    isEdited: base.isEdited || Boolean(touch.isEdited),
    added: base.added + (touch.added ?? 0),
    removed: base.removed + (touch.removed ?? 0),
    diff: diff.length > DIFF_MAX ? diff.slice(0, DIFF_MAX) : diff
  }

  return [next, ...list.filter(f => f.path !== touch.path)].slice(0, 200)
}

export function splitPath(path: string): { file: string; folder: string } {
  const i = path.lastIndexOf('/')

  return i < 0
    ? { file: path, folder: '' }
    : { file: path.slice(i + 1), folder: path.slice(0, i + 1) }
}

// The list of a finished turn stays until the next turn touches a file: typing the command
// that opens the pane must never empty it.
async function startOverIfStale($: EngineInterface): Promise<void> {
  if (await read($, isStale)) {
    await update($, files, () => [])
    await update($, selected, () => null)
    await update($, isStale, () => false)
  }
}

// Shortens a path to its last three parts: /a/b/c/d.ts → b/c/d.ts
export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)

  return parts.length <= 3 ? path : parts.slice(-3).join('/')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'touched-files',
      description: 'Open the pane listing the files read and edited this turn',
      immediate: true
    })

    return next(e)
  })

  on('command.run', { command: 'touched-files' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Touched files', focus: true, closeOnEscape: true })

    return {}
  })

  on('tool.call', { tool: ['Read', 'Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny !== undefined || ran.isError) {
      return ran
    }

    await startOverIfStale($)

    if (e.tool === 'Read') {
      await update($, files, list => recordTouch(list, { path: e.file_path, isRead: true }))

      return ran
    }

    const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
    const patch = patchOf(ran.result)
    await update($, files, list => recordTouch(list, { path, isEdited: true, ...toHunks(patch) }))

    return ran
  })

  // At the end of a turn, if anything changed, a toast says the pane is there.
  on('turn.complete', async ($, e, next) => {
    const list = await read($, files)
    const edited = list.filter(f => f.isEdited).length

    if (edited > 0) {
      $.ui.toast(`${edited} ${edited === 1 ? 'file' : 'files'} edited this turn · /touched-files`)
    }

    await update($, isStale, () => true)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)

    // A failure while drawing shows in the pane itself, never as an empty pane.
    try {
      const list = await read($, files)
      const chosen = await read($, selected)
      const current = list.find(f => f.path === chosen)
      const edited = list.filter(f => f.isEdited)
      const readOnly = list.filter(f => !f.isEdited)
      const added = edited.reduce((sum, f) => sum + f.added, 0)
      const removed = edited.reduce((sum, f) => sum + f.removed, 0)

      // A number under its name: the summary card is made of these.
      const tile = (label: string, value: string, color: string = 'text') => (
        <Box flexDirection="column">
          <Text color={VESUVIUS.ash}>{label}</Text>
          <Text color={color} bold>
            {value}
          </Text>
        </Box>
      )

      const header = (
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text color={VESUVIUS.lava}>◆</Text> <Text bold>Touched files</Text>
          </Text>
          <Text color={VESUVIUS.ash}>last turn</Text>
        </Box>
      )

      if (list.length === 0) {
        return (
          <Box flexDirection="column" rowGap={1}>
            {header}
            <Text color={VESUVIUS.ash}>No files read or edited yet.</Text>
          </Box>
        )
      }

      // One section of the list. A Button takes a label only: the marker, the folder and
      // the counts sit beside it.
      const section = (title: string, color: string, items: readonly TouchedFile[]) =>
        items.length > 0 && (
          <Box flexDirection="column" rowGap={1}>
            <Text color={color} bold>
              {title} <Text color={VESUVIUS.ash}>{items.length}</Text>
            </Text>
            {items.map(f => {
              const { file, folder } = splitPath(f.path)
              const isChosen = f.path === chosen

              return (
                <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
                  <Box flexDirection="row" columnGap={1}>
                    <Text color={isChosen ? color : VESUVIUS.ash}>{isChosen ? '▸' : '·'}</Text>
                    <Button
                      key={`file-${list.indexOf(f)}`}
                      plain
                      label={file}
                      onPress={() => update($, selected, s => (s === f.path ? null : f.path))}
                    />
                    <Text color={VESUVIUS.ash} wrap="truncate-start">
                      {shortPath(folder)}
                    </Text>
                  </Box>
                  {f.isEdited && (
                    <Text>
                      <Text color={VESUVIUS.vineyard}>+{f.added}</Text>{' '}
                      <Text color={VESUVIUS.lava}>-{f.removed}</Text>
                    </Text>
                  )}
                </Box>
              )
            })}
          </Box>
        )

      return (
        <Box flexDirection="column" rowGap={1}>
          {header}
          <Box
            flexDirection="row"
            columnGap={4}
            borderStyle="round"
            borderColor={VESUVIUS.ash}
            paddingX={1}
          >
            {tile('FILES', String(list.length))}
            {tile('EDITED', String(edited.length), VESUVIUS.magma)}
            {tile('READ ONLY', String(readOnly.length), VESUVIUS.gulf)}
            {tile('ADDED', `+${added}`, VESUVIUS.vineyard)}
            {tile('REMOVED', `-${removed}`, VESUVIUS.lava)}
          </Box>
          {section('EDITED', VESUVIUS.magma, edited)}
          {section('READ ONLY', VESUVIUS.gulf, readOnly)}
          {current !== undefined && (
            // The surface draws the diff in a box of its own: a border here would be a second one.
            <Box flexDirection="column" rowGap={1}>
              <Text wrap="truncate-start">
                <Text color={VESUVIUS.tuff} bold>
                  DIFF
                </Text>{' '}
                <Text color={VESUVIUS.ash}>{shortPath(current.path)}</Text>
              </Text>
              {current.diff !== '' ? (
                <Code source={current.diff} format="diff" path={current.path} wrap="truncate-end" />
              ) : (
                <Text color={VESUVIUS.ash}>
                  {current.isEdited ? 'No differences to show.' : 'Read only, not edited.'}
                </Text>
              )}
            </Box>
          )}
          <Text color={VESUVIUS.ash}>
            click a name for its diff · starts over when the next turn touches a file
          </Text>
        </Box>
      )
    } catch (error) {
      return (
        <Text color={VESUVIUS.lava} wrap="wrap">
          touched-files could not draw: {error instanceof Error ? error.message : String(error)}
        </Text>
      )
    }
  })
}
