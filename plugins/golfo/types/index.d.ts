// One day of work: what it cost, the tokens it used, and how the cost split across projects.
export type Day = { usd: number; tokens: number; projects: Record<string, number> }

// Every day recorded, by its date (`2026-10-25`).
export type Days = Record<string, Day>

declare module 'claude-code' {
  interface PluginState {
    golfo: {
      days: Days
      // The session's cost when it was last added to a day, so each turn adds only what is new.
      counted: number | null
    }
  }
}
