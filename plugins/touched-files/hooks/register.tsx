import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TouchedFile } from '../types'
import { VESUVIUS } from './palette'

const PANE = 'touched-files'
const DIFF_MAX = 40_000

const files = atom({ plugin: 'touched-files', key: 'files' } as const, [])
const selected = atom({ plugin: 'touched-files', key: 'selected' } as const, null)

type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

// Turns Edit/Write's structured patch into unified hunks that `Code` can draw.
export function toHunks(patch: readonly Hunk[]): { diff: string; added: number; removed: number } {
  let added = 0
  let removed = 0
  const parts = patch.map(h => {
    for (const line of h.lines) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }

    return [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n')
  })

  return { diff: parts.join('\n'), added, removed }
}

// Adds or updates a file, moving it to the top of the list.
export function recordTouch(list: readonly TouchedFile[], touch: Partial<TouchedFile> & { path: string }): TouchedFile[] {
  const before = list.find(f => f.path === touch.path)
  const base: TouchedFile = before ?? { path: touch.path, isRead: false, isEdited: false, added: 0, removed: 0, diff: '' }
  const diff = touch.diff ? [base.diff, touch.diff].filter(Boolean).join('\n') : base.diff
  const next: TouchedFile = {
    path: touch.path,
    isRead: base.isRead || Boolean(touch.isRead),
    isEdited: base.isEdited || Boolean(touch.isEdited),
    added: base.added + (touch.added ?? 0),
    removed: base.removed + (touch.removed ?? 0),
    diff: diff.length > DIFF_MAX ? diff.slice(0, DIFF_MAX) : diff,
  }

  return [next, ...list.filter(f => f.path !== touch.path)].slice(0, 200)
}

export function splitPath(path: string): { file: string; folder: string } {
  const i = path.lastIndexOf('/')

  return i < 0 ? { file: path, folder: '' } : { file: path.slice(i + 1), folder: path.slice(0, i + 1) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'touched-files',
      description: 'Open the pane listing the files read and edited this turn',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'touched-files' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Touched files', focus: true, closeOnEscape: true })

    return {}
  })

  // Every new prompt starts a new turn: the list starts over.
  on('prompt.submit', async ($, e, next) => {
    await update($, files, () => [])
    await update($, selected, () => null)

    return next(e)
  })

  on('tool.call', { tool: ['Read', 'Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    if (e.tool === 'Read') {
      await update($, files, list => recordTouch(list, { path: e.file_path, isRead: true }))

      return ran
    }

    const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
    const patch = (ran.result as { structuredPatch?: Hunk[] } | undefined)?.structuredPatch ?? []
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

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const list = await read($, files)
    const chosen = await read($, selected)
    const current = list.find(f => f.path === chosen)
    const edited = list.filter(f => f.isEdited).length

    if (list.length === 0) {
      return <Text color={VESUVIUS.ash}>No files touched this turn.</Text>
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Text color={VESUVIUS.tuff}>
          {list.length} {list.length === 1 ? 'file' : 'files'} · <Text color={VESUVIUS.magma}>{edited} edited</Text>
        </Text>
        <Box flexDirection="column">
          {list.map((f, i) => {
            const { file, folder } = splitPath(f.path)

            return (
              <Button
                key={`file-${i}`}
                plain
                onPress={() => update($, selected, s => (s === f.path ? null : f.path))}
              >
                <Text color={f.isEdited ? VESUVIUS.lava : VESUVIUS.gulf} bold>
                  {f.isEdited ? 'M' : 'R'}
                </Text>{' '}
                <Text bold={f.path === chosen}>{file}</Text>{' '}
                <Text color={VESUVIUS.ash}>{folder}</Text>
                {f.isEdited ? ' ' : ''}
                {f.isEdited ? <Text color={VESUVIUS.vineyard}>+{f.added}</Text> : ''}
                {f.isEdited ? ' ' : ''}
                {f.isEdited ? <Text color={VESUVIUS.lava}>-{f.removed}</Text> : ''}
              </Button>
            )
          })}
        </Box>
        {current !== undefined && current.diff !== '' && (
          <Code source={current.diff} format="diff" path={current.path} wrap="truncate-end" />
        )}
        {current !== undefined && current.diff === '' && (
          <Text color={VESUVIUS.ash}>{current.isEdited ? 'No differences to show.' : 'Read only, not edited.'}</Text>
        )}
      </Box>
    )
  })
}
