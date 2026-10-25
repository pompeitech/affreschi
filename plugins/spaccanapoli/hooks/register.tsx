import type { EngineInterface, Register, RenderElement } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { PullRequest, Repo } from '../types'
import { isOnBase, parseBase, parseNumstat, parsePr, parseStatus } from './git'
import { VESUVIUS } from './palette'

// Git is read again at most this often, on a timer and after every tool that can change files.
const REFRESH_MS = 3000
const POLL_MS = 10_000
// gh asks GitHub, so the PR is asked for less often.
const PR_EVERY_MS = 60_000
const BADGE_TEXT = '#1A1A1A'
const FILE_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit'])

const NO_REPO: Repo | null = null
const repo = atom({ plugin: 'spaccanapoli', key: 'repo' } as const, NO_REPO)

// The module's own: where the session runs and when git and gh were last asked.
let cwd = ''
let lastReadAt = Number.NEGATIVE_INFINITY
let lastPrAt = Number.NEGATIVE_INFINITY
let pr: PullRequest | null = null

function logFailure($: EngineInterface, what: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  $.ui.log(`spaccanapoli: ${what} failed: ${reason}`, { to: 'debug' })
}

// One command's output, or null when it could not run or ended in error.
async function output($: EngineInterface, argv: readonly string[]): Promise<string | null> {
  const ran = await $.process.run(argv, { cwd }).catch(error => {
    logFailure($, argv.slice(0, 2).join(' '), error)

    return null
  })

  return ran !== null && ran.exitCode === 0 ? ran.stdout : null
}

// Reads the repository; outside one, the row goes away. Writes only what changed.
async function refresh($: EngineInterface, { force = false } = {}): Promise<void> {
  const now = await $.clock.now()

  if (!force && now - lastReadAt < REFRESH_MS) {
    return
  }

  lastReadAt = now
  const status = await output($, ['git', 'status', '--porcelain=v1', '--branch'])
  let next: Repo | null = null

  if (status !== null) {
    const { branch, ahead, behind, files } = parseStatus(status)
    const { added, removed } = parseNumstat(
      (await output($, ['git', 'diff', '--numstat', 'HEAD'])) ?? ''
    )
    const base = parseBase(
      (await output($, ['git', 'rev-parse', '--abbrev-ref', 'origin/HEAD'])) ?? ''
    )

    if (force || now - lastPrAt >= PR_EVERY_MS) {
      lastPrAt = now
      const view = await output($, ['gh', 'pr', 'view', '--json', 'number,state,isDraft,mergeable'])
      pr = view === null ? null : parsePr(view)
    }

    next = { branch, base, ahead, behind, files, added, removed, pr }
  }

  if (JSON.stringify(next) !== JSON.stringify(await read($, repo))) {
    await update($, repo, () => next)
  }
}

// What the PR part of the row says, and in which color.
function prLabel(p: PullRequest): { text: string; color: string } {
  if (p.state === 'MERGED') {
    return { text: `PR #${p.number} merged`, color: VESUVIUS.vineyard }
  }

  if (p.state === 'CLOSED') {
    return { text: `PR #${p.number} closed`, color: VESUVIUS.ash }
  }

  if (p.mergeable === 'CONFLICTING') {
    return { text: `PR #${p.number} · conflicts`, color: VESUVIUS.lava }
  }

  return {
    text: `PR #${p.number} ${p.isDraft ? 'draft' : 'open'}${p.mergeable === 'MERGEABLE' ? ' · mergeable' : ''}`,
    color: VESUVIUS.gulf
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
    cwd = e.cwd
    await refresh($, { force: true })
    $.clock.every(POLL_MS, () => {
      refresh($).catch(error => logFailure($, 'reading git', error))
    })

    return next(e)
  })

  // A tool that can change files: the row follows right after it.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)

    if (FILE_TOOLS.has(String(e.tool))) {
      await refresh($).catch(error => logFailure($, 'reading git', error))
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($, { force: true }).catch(error => logFailure($, 'reading git', error))

    return result
  })

  // The row, over whatever band a plugin beneath draws.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const below = await next(e).catch(error => {
      logFailure($, 'drawing the band beneath', error)

      return null
    })
    const r = await read($, repo)
    const { Box, Text } = $.ui.resolve(e)

    if (r === null) {
      return hasContent(below) ? below : <Box />
    }

    const onBase = isOnBase(r.branch, r.base)
    const isRisky = onBase && r.files > 0
    const branchColor = isRisky ? VESUVIUS.lava : VESUVIUS.vineyard
    const pull = r.pr === null ? null : prLabel(r.pr)
    const changed = r.added + r.removed

    const row = (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
          <Text wrap="truncate-end">
            <Text color={branchColor}>⎇</Text>{' '}
            <Text bold color={isRisky ? VESUVIUS.lava : undefined}>
              {r.branch}
            </Text>
            {r.base !== null && !onBase && <Text color={VESUVIUS.ash}> → {r.base}</Text>}{' '}
            <Text color={r.ahead > 0 ? VESUVIUS.vineyard : VESUVIUS.ash}>↑{r.ahead}</Text>{' '}
            <Text color={r.behind > 0 ? VESUVIUS.magma : VESUVIUS.ash}>↓{r.behind}</Text>
          </Text>
          <Box flexDirection="row" columnGap={2}>
            <Text>
              <Text color={VESUVIUS.ash}>
                {r.files} {r.files === 1 ? 'file' : 'files'}
              </Text>{' '}
              <Text color={VESUVIUS.vineyard}>+{r.added}</Text>{' '}
              <Text color={VESUVIUS.lava}>−{r.removed}</Text>
            </Text>
            {isRisky ? (
              <Text backgroundColor={VESUVIUS.lava} color={BADGE_TEXT} bold>
                {` ATTENTO: SEI SU ${r.branch.toUpperCase()} `}
              </Text>
            ) : (
              pull !== null && <Text color={pull.color}>{pull.text}</Text>
            )}
          </Box>
        </Box>
        {changed > 0 && (
          <Box flexDirection="row" height={1}>
            <Box width={0} flexGrow={r.added} height={1} backgroundColor={VESUVIUS.vineyard}>
              <Text> </Text>
            </Box>
            <Box width={0} flexGrow={r.removed} height={1} backgroundColor={VESUVIUS.lava}>
              <Text> </Text>
            </Box>
          </Box>
        )}
      </Box>
    )

    return hasContent(below) ? (
      <Box flexDirection="column">
        {row}
        {below}
      </Box>
    ) : (
      row
    )
  })
}
