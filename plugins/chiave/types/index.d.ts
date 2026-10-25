// A rule you keep approving, in the permissions' own spelling (`Bash(npm run lint:*)`).
export type Tally = { count: number; examples: string[]; lastAt: number }

// A call Chiave will never offer to allow, and why.
export type Risky = { count: number; reason: string }

// Where an added rule went: the project's shared settings, or yours alone.
export type Scope = 'project' | 'local'

export type Added = { rule: string; scope: Scope; at: number }

// Everything Chiave knows about one project.
export type Ledger = {
  tallies: Record<string, Tally>
  risky: Record<string, Risky>
  ignored: string[]
  added: Added[]
}

declare module 'claude-code' {
  interface PluginState {
    chiave: { ledger: Ledger }
  }
}
