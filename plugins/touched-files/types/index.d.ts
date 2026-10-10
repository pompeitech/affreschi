export type TouchedFile = {
  path: string
  isRead: boolean
  isEdited: boolean
  added: number
  removed: number
  diff: string
}

declare module 'claude-code' {
  interface PluginState {
    'touched-files': { files: TouchedFile[]; selected: string | null }
  }
}
