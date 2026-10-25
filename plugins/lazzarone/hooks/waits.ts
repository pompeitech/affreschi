// What Claude is waiting on you for, how to say it, and which waits are due a call.

export type Wait = { what: string; since: number; isCalled: boolean }

// The command a Bash call wants to run, when the input carries one.
function commandOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || !('command' in input)) {
    return undefined
  }

  return typeof input.command === 'string' ? input.command : undefined
}

// What a tool call that needs you is waiting for, in a few words.
export function describe(tool: string, input: unknown): string {
  if (tool === 'AskUserQuestion') {
    return 'ti ha fatto una domanda'
  }

  if (tool === 'ExitPlanMode') {
    return 'ti propone un piano da approvare'
  }

  const command = commandOf(input)

  if (command !== undefined) {
    const short = command.trim().split('\n')[0] ?? ''

    return `vuole il permesso per: ${short.length > 60 ? `${short.slice(0, 59)}…` : short}`
  }

  return `vuole il permesso per usare ${tool}`
}

// The waits that have lasted `afterMs` and have not had their call yet.
export function dueWaits(waits: ReadonlyMap<string, Wait>, now: number, afterMs: number): string[] {
  return [...waits].filter(([, w]) => !w.isCalled && now - w.since >= afterMs).map(([id]) => id)
}

// The notification's title for a wait that has lasted `ms`.
export function titleFor(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))

  return `Claude ti aspetta da ${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}`
}
