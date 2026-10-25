export type Mask = 'pulcinella' | 'arlecchino' | 'balanzone' | 'nessuna'

declare module 'claude-code' {
  interface PluginState {
    // The mask Claude wears in this session.
    maschere: { mask: Mask }
  }
}
