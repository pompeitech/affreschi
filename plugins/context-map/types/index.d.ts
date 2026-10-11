export type Segment = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

// One line of a detail section: a memory file, an MCP server, an agent type, a skill.
export type DetailItem = { name: string; note: string; tokens: number }

export type ContextMap = {
  percent: number
  total: number
  max: number
  model: string
  autoCompactThreshold: number | null
  segments: Segment[]
  memoryFiles: DetailItem[]
  mcpServers: DetailItem[]
  agents: DetailItem[]
  skills: DetailItem[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-map': { map: ContextMap | null; isLegendHidden: boolean }
  }
}
