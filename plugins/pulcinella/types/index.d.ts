export type Mood = 'idle' | 'working' | 'happy' | 'worried' | 'stunned' | 'sleeping'

// What Pulcinella shows now: his face and the line he says beside it.
export type Face = { mood: Mood; quote: string }

export type Segment = {
  name: string
  tokens: number
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

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
    pulcinella: {
      face: Face
      // Every token spent with him, across sessions (kept in $.store, mirrored here to draw).
      tokens: number
      // The animation's frame counter.
      tick: number
      map: ContextMap | null
      isLegendHidden: boolean
      // The context's size at the end of each recent turn, oldest first, for the pace estimate.
      totals: number[]
    }
  }
}
