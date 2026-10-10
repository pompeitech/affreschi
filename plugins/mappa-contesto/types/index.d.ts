export type Segmento = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

export type Mappa = {
  percent: number
  total: number
  max: number
  segments: Segmento[]
}

declare module 'claude-code' {
  interface PluginState {
    'mappa-contesto': { mappa: Mappa | null; isExpanded: boolean }
  }
}
