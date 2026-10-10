export type Segment = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

export type ContextMap = {
  percent: number
  total: number
  max: number
  segments: Segment[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-map': { map: ContextMap | null; isExpanded: boolean }
  }
}
