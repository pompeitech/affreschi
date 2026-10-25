// The PR of the current branch, as `gh pr view` reports it.
export type PullRequest = {
  number: number
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
}

// The repository as the row draws it.
export type Repo = {
  branch: string
  // The branch the default remote branch points at (main, master…), when known.
  base: string | null
  ahead: number
  behind: number
  files: number
  added: number
  removed: number
  pr: PullRequest | null
}

declare module 'claude-code' {
  interface PluginState {
    // null outside a git repository, or before the first read.
    spaccanapoli: { repo: Repo | null }
  }
}
