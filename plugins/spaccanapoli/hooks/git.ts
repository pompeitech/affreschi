import type { PullRequest } from '../types'

// What git and gh print, read into the row's numbers. Each reader takes the command's output as
// text and checks it, so an unexpected line is skipped rather than trusted.

export type Status = { branch: string; ahead: number; behind: number; files: number }

// `git status --porcelain=v1 --branch`: the `##` header names the branch and how far it is from
// its upstream; every other line is a changed or untracked file.
export function parseStatus(output: string): Status {
  const lines = output.split('\n').filter(line => line !== '')
  const header = lines.find(line => line.startsWith('## ')) ?? ''
  const files = lines.filter(line => !line.startsWith('## ')).length
  const name = header.slice(3)
  const unborn = /^No commits yet on (.+)$/.exec(name)
  const branch = unborn?.[1] ?? name.split('...')[0]?.split(' ')[0] ?? ''
  const ahead = Number(/ahead (\d+)/.exec(name)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(name)?.[1] ?? 0)

  return { branch: branch === 'HEAD' ? 'detached' : branch, ahead, behind, files }
}

// `git diff --numstat HEAD`: lines added and removed in every tracked file; a binary file
// (`-` in both columns) counts as neither.
export function parseNumstat(output: string): { added: number; removed: number } {
  let added = 0
  let removed = 0

  for (const line of output.split('\n')) {
    const [plus, minus] = line.split('\t')
    const a = Number(plus)
    const r = Number(minus)

    if (Number.isInteger(a) && Number.isInteger(r)) {
      added += a
      removed += r
    }
  }

  return { added, removed }
}

// `git rev-parse --abbrev-ref origin/HEAD`, as `origin/main`: the branch after the remote's name.
export function parseBase(output: string): string | null {
  const ref = output.trim()
  const slash = ref.indexOf('/')

  return slash > 0 && slash < ref.length - 1 ? ref.slice(slash + 1) : null
}

const STATES: readonly PullRequest['state'][] = ['OPEN', 'CLOSED', 'MERGED']
const MERGEABLE: readonly PullRequest['mergeable'][] = ['MERGEABLE', 'CONFLICTING', 'UNKNOWN']

// `gh pr view --json number,state,isDraft,mergeable`, checked field by field.
export function parsePr(output: string): PullRequest | null {
  let data: unknown

  try {
    data = JSON.parse(output)
  } catch {
    return null
  }

  if (typeof data !== 'object' || data === null) {
    return null
  }

  const number = 'number' in data ? data.number : undefined
  const state = STATES.find(s => 'state' in data && data.state === s)
  const isDraft = 'isDraft' in data ? data.isDraft : undefined
  const mergeable = MERGEABLE.find(m => 'mergeable' in data && data.mergeable === m) ?? 'UNKNOWN'

  if (typeof number !== 'number' || state === undefined || typeof isDraft !== 'boolean') {
    return null
  }

  return { number, state, isDraft, mergeable }
}

// Working right on the base branch (or on main or master when the base is unknown).
export function isOnBase(branch: string, base: string | null): boolean {
  return base === null ? branch === 'main' || branch === 'master' : branch === base
}
