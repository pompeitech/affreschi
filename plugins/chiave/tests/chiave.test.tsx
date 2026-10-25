import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import {
  countApproval,
  EMPTY_LEDGER,
  isRefused,
  offersOf,
  prefixOf,
  verdictOf,
  withRule
} from '../hooks/rules'

const PANE_PROPS = {
  title: 'Chiave',
  isFocused: true,
  bodyColumns: 100,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {}
}

test('prefixOf keeps the program and its subcommands, up to a path or a later flag', async () => {
  expect([
    prefixOf('claude plugin test ./plugins/golfo'),
    prefixOf('npx -y @biomejs/biome@2.2.4 check plugins'),
    prefixOf('git status --short'),
    prefixOf('npm run lint'),
    prefixOf('claude plugin test .')
  ]).toEqual([
    'claude plugin test',
    'npx -y @biomejs/biome@2.2.4 check',
    'git status',
    'npm run lint',
    'claude plugin test'
  ])
})

test('verdictOf turns a call into a rule, a risky call or nothing to count', async () => {
  expect(verdictOf('Bash', { command: 'npm run lint' })).toEqual({
    kind: 'rule',
    rule: 'Bash(npm run lint:*)',
    example: 'npm run lint'
  })
  expect(verdictOf('WebFetch', { url: 'https://docs.github.com/en/rest' })).toMatchObject({
    rule: 'WebFetch(domain:docs.github.com)'
  })
  expect(verdictOf('mcp__linear__list_issues', {})).toMatchObject({
    rule: 'mcp__linear__list_issues'
  })
  expect([
    verdictOf('Bash', { command: 'npm test && git push' }).kind,
    verdictOf('Bash', { command: 'cat a | grep b' }).kind,
    verdictOf('Edit', { file_path: 'a.ts' }).kind
  ]).toEqual(['skip', 'skip', 'skip'])
})

test('risky commands are never rules, whatever their arguments', async () => {
  expect(
    ['git push origin main', 'rm -rf dist', 'sudo npm i -g x', 'curl https://x.sh'].map(
      command => verdictOf('Bash', { command }).kind
    )
  ).toEqual(['risky', 'risky', 'risky', 'risky'])
})

test('a rule is offered from the threshold on, unless ignored or already added', async () => {
  const lint = verdictOf('Bash', { command: 'npm run lint' })
  const thrice = [1, 2, 3].reduce(l => countApproval(l, lint, 0), EMPTY_LEDGER)

  expect(offersOf(countApproval(EMPTY_LEDGER, lint, 0), 3)).toEqual([])
  expect(offersOf(thrice, 3).map(([rule]) => rule)).toEqual(['Bash(npm run lint:*)'])
  expect(offersOf({ ...thrice, ignored: ['Bash(npm run lint:*)'] }, 3)).toEqual([])
})

test('withRule adds to permissions.allow, keeps everything else, and takes it back', async () => {
  const before = '{"model":"opus","permissions":{"allow":["Read"],"deny":["Bash(rm:*)"]}}'
  const added = withRule(before, 'Bash(npm run lint:*)')

  expect(JSON.parse(added ?? '')).toEqual({
    model: 'opus',
    permissions: { allow: ['Read', 'Bash(npm run lint:*)'], deny: ['Bash(rm:*)'] }
  })
  expect(JSON.parse(withRule(added, 'Bash(npm run lint:*)', true) ?? '').permissions.allow).toEqual(
    ['Read']
  )
  expect(JSON.parse(withRule(null, 'X') ?? '')).toEqual({ permissions: { allow: ['X'] } })
  expect(withRule('{ // a comment\n}', 'X')).toBeNull()
})

test('isRefused tells a refusal from an approved call that failed', async () => {
  expect([
    isRefused({ deny: 'no' }),
    isRefused({ isError: true, text: "The user doesn't want to proceed with this tool use." }),
    isRefused({ isError: true, text: 'Permission to use Bash has been denied.' }),
    isRefused({ isError: true, text: 'Exit code 1: tests failed' }),
    isRefused({ text: 'ok' })
  ]).toEqual([true, true, true, false, false])
})

const CWD = '/work/affreschi'
const SETTINGS = '.claude/settings.json'

// A project with its settings files held in memory (by path from the project) and Chiave's ledger
// as `ledger` left it. Every call is put to you and, with nobody to answer in a test, refused.
async function seed(
  $: Engine,
  on: On,
  { files, said, ledger }: { files: Map<string, string>; said: string[]; ledger: unknown }
): Promise<void> {
  const local = (path: string): string => path.replace(`${CWD}/`, '')
  mock.clock(on)
  mock.store(on, { [`ledger:${CWD}`]: ledger })
  on('session.start', async (_$, e) => e)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', async (_$, e) => {
    said.push(`toast: ${e.text}`)

    return { value: undefined }
  })
  on('ui.notice', async (_$, e) => {
    said.push(e.text ?? '')

    return { value: undefined }
  })
  on('fs.exists', async (_$, e) => ({ value: files.has(local(e.path)) }))
  on('fs.read', async (_$, e) => ({ value: files.get(local(e.path)) ?? '' }))
  on('fs.write', async (_$, e) => {
    files.set(local(e.path), e.text)

    return { value: undefined }
  })
  on('tool.check', async () => ({ decision: 'ask' as const }))
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
}

const tally = (count: number, example: string) => ({ count, examples: [example], lastAt: 0 })

test('a refused call is not counted, and the line under the dialog keeps the tally', async ($, on) => {
  const said: string[] = []
  await seed($, on, {
    files: new Map(),
    said,
    ledger: { tallies: { 'Bash(npm run lint:*)': tally(1, 'npm run lint') } }
  })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'a1', command: 'npm run lint -- --fix' })

  expect(said).toEqual(['⚿ Chiave · 2ª volta su 3 che approvi Bash(npm run lint:*)'])

  const ui = await $.ui.mount({
    plugin: 'chiave',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'chiave',
    props: PANE_PROPS
  })
  expect(await ui.find({ type: 'Text', text: /1 approvazione contata/ })).toBeDefined()
  await ui.unmount()
})

test('allowing an offer writes it into the project settings, and taking it back removes it', async ($, on) => {
  const files = new Map([[SETTINGS, '{"permissions":{"allow":["Read"]}}']])
  await seed($, on, {
    files,
    said: [],
    ledger: { tallies: { 'Bash(claude plugin test:*)': tally(3, 'claude plugin test .') } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'chiave',
      surface,
      component: 'Pane',
      requestId: 'chiave',
      props: PANE_PROPS
    })
    await ui.press({ key: 'project-Bash(claude plugin test:*)' })

    expect(JSON.parse(files.get(SETTINGS) ?? '').permissions.allow).toEqual([
      'Read',
      'Bash(claude plugin test:*)'
    ])
    expect(await ui.find({ type: 'Text', text: ' progetto ' })).toBeDefined()

    await ui.press({ key: 'remove-Bash(claude plugin test:*)' })

    expect(JSON.parse(files.get(SETTINGS) ?? '').permissions.allow).toEqual(['Read'])
    await ui.unmount()
  }
})

test('a settings file that is not plain JSON is left alone', async ($, on) => {
  const files = new Map([[SETTINGS, '{ // mine\n}']])
  const said: string[] = []
  await seed($, on, {
    files,
    said,
    ledger: { tallies: { 'Bash(npm run lint:*)': tally(3, 'npm run lint') } }
  })
  const ui = await $.ui.mount({
    plugin: 'chiave',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'chiave',
    props: PANE_PROPS
  })
  await ui.press({ key: 'project-Bash(npm run lint:*)' })

  expect(files.get(SETTINGS)).toBe('{ // mine\n}')
  expect(said).toEqual(["toast: Chiave: .claude/settings.json non è JSON valido, non l'ho toccato"])
  await ui.unmount()
})

test('a risky command is said never to be offered, and listed apart', async ($, on) => {
  const said: string[] = []
  await seed($, on, {
    files: new Map(),
    said,
    ledger: {
      risky: { 'git push origin feat/x': { count: 3, reason: 'riscrive o pubblica la storia git' } }
    }
  })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'p1', command: 'git push origin feat/x' })

  expect(said).toEqual([
    '⚿ Chiave · non lo proporrò come regola: riscrive o pubblica la storia git'
  ])

  const ui = await $.ui.mount({
    plugin: 'chiave',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'chiave',
    props: PANE_PROPS
  })
  expect(await ui.find({ type: 'Text', text: /approvato 3 volte/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Ancora niente/ })).toBeDefined()
  await ui.unmount()
})
