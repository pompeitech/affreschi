// What one loop consumed: the main conversation, or one subagent.
export type AgentUsage = {
  id: string
  label: string
  type: string
  model: string
  status: 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed' | 'pending'
  steps: number
  tools: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  durationMs: number | null
  // The turn it last did something in: busy, or touched in the current turn, it stays on stage.
  lastTurn: number
}

// The character an agent plays, from its type or its name.
export type Role =
  | 'pulcinella'
  | 'artist'
  | 'nerd'
  | 'explorer'
  | 'reviewer'
  | 'guard'
  | 'tester'
  | 'handyman'

// What the archive's clear-out took off the list, still counted in the totals.
export type Cleared = { tokens: number; steps: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-usage': {
      agents: AgentUsage[]
      expanded: string | null
      costUsd: number | null
      // The session's turn number, counted at every prompt.
      turn: number
      // The archive group shown open, by role.
      openGroup: Role | null
      cleared: Cleared
    }
  }
}
