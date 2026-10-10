export type FileToccato = {
  path: string
  isRead: boolean
  isEdited: boolean
  added: number
  removed: number
  diff: string
}

declare module 'claude-code' {
  interface PluginState {
    'file-toccati': { files: FileToccato[]; selected: string | null }
  }
}
