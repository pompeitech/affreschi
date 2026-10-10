import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FileToccato } from '../types'
import { VESUVIUS } from './vesuvius'

const PANE = 'file-toccati'
const DIFF_MAX = 40_000

const files = atom({ plugin: 'file-toccati', key: 'files' } as const, [])
const selected = atom({ plugin: 'file-toccati', key: 'selected' } as const, null)

type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

// Trasforma la patch strutturata di Edit/Write in hunk unificati che `Code` sa disegnare.
export function hunks(patch: readonly Hunk[]): { diff: string; added: number; removed: number } {
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

// Aggiunge o aggiorna un file, portandolo in cima alla lista.
export function registra(list: readonly FileToccato[], tocco: Partial<FileToccato> & { path: string }): FileToccato[] {
  const prima = list.find(f => f.path === tocco.path)
  const base: FileToccato = prima ?? { path: tocco.path, isRead: false, isEdited: false, added: 0, removed: 0, diff: '' }
  const diff = tocco.diff ? [base.diff, tocco.diff].filter(Boolean).join('\n') : base.diff
  const nuovo: FileToccato = {
    path: tocco.path,
    isRead: base.isRead || Boolean(tocco.isRead),
    isEdited: base.isEdited || Boolean(tocco.isEdited),
    added: base.added + (tocco.added ?? 0),
    removed: base.removed + (tocco.removed ?? 0),
    diff: diff.length > DIFF_MAX ? diff.slice(0, DIFF_MAX) : diff,
  }

  return [nuovo, ...list.filter(f => f.path !== tocco.path)].slice(0, 200)
}

export function nome(path: string): { file: string; cartella: string } {
  const i = path.lastIndexOf('/')

  return i < 0 ? { file: path, cartella: '' } : { file: path.slice(i + 1), cartella: path.slice(0, i + 1) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'file-toccati',
      description: 'Apre il pannello con i file letti e modificati nel turno',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'file-toccati' }, async $ => {
    await $.ui.open({ id: PANE, title: 'File toccati', focus: true, closeOnEscape: true })

    return {}
  })

  // Ogni nuovo prompt apre un turno nuovo: la lista riparte da zero.
  on('prompt.submit', async ($, e, next) => {
    await update($, files, () => [])
    await update($, selected, () => null)

    return next(e)
  })

  on('tool.call', { tool: ['Read', 'Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    if (e.tool === 'Read') {
      await update($, files, list => registra(list, { path: e.file_path, isRead: true }))

      return ran
    }

    const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
    const patch = (ran.result as { structuredPatch?: Hunk[] } | undefined)?.structuredPatch ?? []
    await update($, files, list => registra(list, { path, isEdited: true, ...hunks(patch) }))

    return ran
  })

  // A fine turno, se qualcosa è cambiato, un avviso che il pannello è lì.
  on('turn.complete', async ($, e, next) => {
    const list = await read($, files)
    const modificati = list.filter(f => f.isEdited).length
    if (modificati > 0) {
      $.ui.toast(`${modificati} file modificati in questo turno · /file-toccati`)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const list = await read($, files)
    const scelto = await read($, selected)
    const corrente = list.find(f => f.path === scelto)
    const modificati = list.filter(f => f.isEdited).length

    if (list.length === 0) {
      return <Text color={VESUVIUS.cenere}>Nessun file toccato in questo turno.</Text>
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Text color={VESUVIUS.tufo}>
          {list.length} file · <Text color={VESUVIUS.magma}>{modificati} modificati</Text>
        </Text>
        <Box flexDirection="column">
          {list.map((f, i) => {
            const { file, cartella } = nome(f.path)

            return (
              <Button
                key={`file-${i}`}
                plain
                onPress={() => update($, selected, s => (s === f.path ? null : f.path))}
              >
                <Text color={f.isEdited ? VESUVIUS.lava : VESUVIUS.golfo} bold>
                  {f.isEdited ? 'M' : 'R'}
                </Text>{' '}
                <Text bold={f.path === scelto}>{file}</Text>{' '}
                <Text color={VESUVIUS.cenere}>{cartella}</Text>
                {f.isEdited ? ' ' : ''}
                {f.isEdited ? <Text color={VESUVIUS.vigna}>+{f.added}</Text> : ''}
                {f.isEdited ? ' ' : ''}
                {f.isEdited ? <Text color={VESUVIUS.lava}>-{f.removed}</Text> : ''}
              </Button>
            )
          })}
        </Box>
        {corrente !== undefined && corrente.diff !== '' && (
          <Code source={corrente.diff} format="diff" path={corrente.path} wrap="truncate-end" />
        )}
        {corrente !== undefined && corrente.diff === '' && (
          <Text color={VESUVIUS.cenere}>{corrente.isEdited ? 'Nessuna differenza da mostrare.' : 'Solo letto, nessuna modifica.'}</Text>
        )}
      </Box>
    )
  })
}
