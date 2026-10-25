import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { isOnBase, parseBase, parseNumstat, parsePr, parseStatus } from '../hooks/git'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 12 },
  view: {}
}

test('parseStatus reads the branch, its distance from upstream and the files changed', async () => {
  expect(parseStatus('## feat/x...origin/feat/x [ahead 2, behind 1]\n M a.ts\n?? b.ts\n')).toEqual({
    branch: 'feat/x',
    ahead: 2,
    behind: 1,
    files: 2
  })
  expect(parseStatus('## main\n')).toEqual({ branch: 'main', ahead: 0, behind: 0, files: 0 })
  expect(parseStatus('## No commits yet on main\n?? a.ts\n').branch).toBe('main')
  expect(parseStatus('## HEAD (no branch)\n').branch).toBe('detached')
})

test('parseNumstat sums lines added and removed, skipping binary files', async () => {
  expect(parseNumstat('10\t2\ta.ts\n-\t-\timg.png\n3\t0\tb.ts\n')).toEqual({
    added: 13,
    removed: 2
  })
})

test('parseBase takes the branch after the remote', async () => {
  expect([parseBase('origin/main\n'), parseBase('origin/HEAD'), parseBase('')]).toEqual([
    'main',
    'HEAD',
    null
  ])
})

test('parsePr checks every field and gives up on anything else', async () => {
  expect(parsePr('{"number":2,"state":"OPEN","isDraft":false,"mergeable":"MERGEABLE"}')).toEqual({
    number: 2,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE'
  })
  expect([parsePr('no pull requests found'), parsePr('{"number":"2"}'), parsePr('null')]).toEqual([
    null,
    null,
    null
  ])
})

test('isOnBase falls back to main and master when the base is unknown', async () => {
  expect([isOnBase('main', 'main'), isOnBase('feat/x', 'main'), isOnBase('master', null)]).toEqual([
    true,
    false,
    true
  ])
})

// A repository on `branch` with what git and gh print; `gh` null when there is no PR.
async function seed(
  $: Engine,
  on: On,
  repo: { status: string; numstat: string; gh: string | null }
): Promise<void> {
  mock.clock(on)
  on('session.start', async (_$, e) => e)
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  on('process.run', async (_$, e) => {
    const [tool, verb] = e.argv
    const stdout =
      tool === 'gh'
        ? repo.gh
        : verb === 'status'
          ? repo.status
          : verb === 'diff'
            ? repo.numstat
            : 'origin/main\n'

    return {
      value: {
        exitCode: stdout === null ? 1 : 0,
        stdout: stdout ?? '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
}

test('the row shows the branch, its distance, the changes and its PR', async ($, on) => {
  await seed($, on, {
    status: '## feat/x...origin/feat/x [ahead 2]\n M a.ts\n',
    numstat: '40\t12\ta.ts\n',
    gh: '{"number":2,"state":"OPEN","isDraft":false,"mergeable":"MERGEABLE"}'
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'spaccanapoli',
      surface,
      component: 'AbovePrompt',
      props: BAND_PROPS
    })
    expect(await ui.find({ type: 'Text', text: /feat\/x → main ↑2 ↓0/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 file \+40 −12/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'PR #2 open · mergeable' })).toBeDefined()
    await ui.unmount()
  }
})

test('changes made right on main raise the warning in place of the PR', async ($, on) => {
  await seed($, on, { status: '## main\n M a.ts\n M b.ts\n', numstat: '1\t1\ta.ts\n', gh: null })

  const ui = await $.ui.mount({
    plugin: 'spaccanapoli',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: BAND_PROPS
  })
  expect(await ui.find({ type: 'Text', text: / ATTENTO: SEI SU MAIN / })).toBeDefined()
  await ui.unmount()
})

test('outside a git repository the row stays away', async ($, on) => {
  mock.clock(on)
  on('session.start', async (_$, e) => e)
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>pulcinella</Text>
  })
  on('process.run', async () => ({
    value: {
      exitCode: 128,
      stdout: '',
      stderr: 'not a git repository',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'spaccanapoli',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS
  })
  expect(await ui.find({ type: 'Text', text: 'pulcinella' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⎇/ })).toBeUndefined()
  await ui.unmount()
})
