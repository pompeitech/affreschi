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
}

declare module 'claude-code' {
  interface PluginState {
    'agent-usage': { agents: AgentUsage[]; expanded: string | null; costUsd: number | null }
  }
}
