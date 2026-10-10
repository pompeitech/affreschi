import { expect, test } from 'claude-code/testing'

import { hunks, nome, registra } from '../hooks/register'

const PANE_PROPS = {
  title: 'File toccati',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

test('hunks conta righe aggiunte e tolte e scrive gli header @@', async () => {
  const { diff, added, removed } = hunks([
    { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '+c'] },
  ])
  expect(added).toBe(1)
  expect(removed).toBe(1)
  expect(diff).toBe('@@ -1,2 +1,2 @@\n a\n-b\n+c')
})

test('registra unisce i tocchi dello stesso file e lo porta in cima', async () => {
  let list = registra([], { path: '/a.ts', isRead: true })
  list = registra(list, { path: '/b.ts', isRead: true })
  list = registra(list, { path: '/a.ts', isEdited: true, added: 3, removed: 1, diff: 'x' })
  expect(list.map(f => f.path)).toEqual(['/a.ts', '/b.ts'])
  expect(list[0]).toEqual({ path: '/a.ts', isRead: true, isEdited: true, added: 3, removed: 1, diff: 'x' })
})

test('nome separa file e cartella', async () => {
  expect(nome('/src/app/main.ts')).toEqual({ file: 'main.ts', cartella: '/src/app/' })
  expect(nome('main.ts')).toEqual({ file: 'main.ts', cartella: '' })
})

test('il pannello mostra i file toccati e il diff di quello scelto', async ($, on) => {
  // Sotto la mod, al posto dei tool veri: una lettura e una modifica.
  on('tool.call', { tool: 'Read' }, async () => ({ result: { type: 'text', file: { filePath: '/src/a.ts', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } } }))
  on('tool.call', { tool: 'Edit' }, async () => ({
    result: {
      filePath: '/src/b.ts',
      oldString: 'b',
      newString: 'c',
      originalFile: 'a\nb\n',
      structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '+c'] }],
      userModified: false,
      replaceAll: false,
    },
  }))

  await $.tool.call({ tool: 'Read', tool_use_id: 't1', file_path: '/src/a.ts' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 't2', file_path: '/src/b.ts', old_string: 'b', new_string: 'c' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'file-toccati', surface, component: 'Pane', requestId: 'file-toccati', props: PANE_PROPS })
    expect((await ui.find({ type: 'Text', text: /2 file/ }))).toBeDefined()

    // Il file modificato è in cima: lo premo e compare il suo diff.
    expect((await ui.find({ key: 'file-0' }))?.text).toMatch(/b\.ts/)
    await ui.press({ key: 'file-0' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(String(code?.props.source)).toContain('+c')

    // Ripremendolo il diff si chiude.
    await ui.press({ key: 'file-0' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.unmount()
  }
})
