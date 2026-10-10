import { expect, test } from 'claude-code/testing'

import { recordTouch, splitPath, toHunks } from '../hooks/register'

const PANE_PROPS = {
  title: 'Touched files',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

test('toHunks counts added and removed lines and writes @@ headers', async () => {
  const { diff, added, removed } = toHunks([
    { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '+c'] },
  ])
  expect(added).toBe(1)
  expect(removed).toBe(1)
  expect(diff).toBe('@@ -1,2 +1,2 @@\n a\n-b\n+c')
})

test('recordTouch merges touches of the same file and moves it to the top', async () => {
  let list = recordTouch([], { path: '/a.ts', isRead: true })
  list = recordTouch(list, { path: '/b.ts', isRead: true })
  list = recordTouch(list, { path: '/a.ts', isEdited: true, added: 3, removed: 1, diff: 'x' })
  expect(list.map(f => f.path)).toEqual(['/a.ts', '/b.ts'])
  expect(list[0]).toEqual({ path: '/a.ts', isRead: true, isEdited: true, added: 3, removed: 1, diff: 'x' })
})

test('splitPath separates file and folder', async () => {
  expect(splitPath('/src/app/main.ts')).toEqual({ file: 'main.ts', folder: '/src/app/' })
  expect(splitPath('main.ts')).toEqual({ file: 'main.ts', folder: '' })
})

test('the pane lists the touched files and the chosen one’s diff', async ($, on) => {
  // Beneath the mod, in place of the real tools: one read and one edit.
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
    const ui = await $.ui.mount({ plugin: 'touched-files', surface, component: 'Pane', requestId: 'touched-files', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /2 files/ })).toBeDefined()

    // The edited file is on top: pressing it shows its diff.
    expect((await ui.find({ key: 'file-0' }))?.text).toMatch(/b\.ts/)
    await ui.press({ key: 'file-0' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(String(code?.props.source)).toContain('+c')

    // Pressing it again closes the diff.
    await ui.press({ key: 'file-0' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.unmount()
  }
})
