import type { Ledger, Scope, Tally } from '../types'

// From a call to the rule that would allow it, which calls are too risky to allow for good,
// the ledger of approvals, and the settings file a rule is written into.

// What a call comes to: a rule Chiave may offer, a risky call it never will, or nothing to count.
export type Verdict =
  | { kind: 'rule'; rule: string; example: string }
  | { kind: 'risky'; label: string; reason: string }
  | { kind: 'skip' }

export const EMPTY_LEDGER: Ledger = { tallies: {}, risky: {}, ignored: [], added: [] }

// How many examples each rule keeps, and how many words a Bash rule takes at most.
const EXAMPLES = 3
const MAX_WORDS = 4

// Commands that change or destroy things outside the work at hand: never allowed for good.
const RISKY: readonly (readonly [RegExp, string])[] = [
  [/^(sudo|su|doas)\b/, 'dà i permessi di amministratore'],
  [/^(rm|rmdir|shred|dd|mkfs)\b/, 'cancella o sovrascrive file'],
  [/^(chmod|chown)\b/, 'cambia permessi o proprietari'],
  [/^(kill|killall|pkill|shutdown|reboot)\b/, 'ferma processi o la macchina'],
  [/^(curl|wget)\b/, 'scarica dalla rete'],
  [/^git\s+(push|reset|clean|rebase|filter-branch)\b/, 'riscrive o pubblica la storia git'],
  [/^git\s+(branch|tag)\s+-[dD]\b/, 'cancella branch o tag'],
  [/^git\s+checkout\s+--\s/, 'butta via modifiche'],
  [/^(npm|yarn|pnpm|bun)\s+publish\b/, 'pubblica un pacchetto'],
  [/^(docker|podman)\s+(rm|rmi|system\s+prune)\b/, 'cancella container o immagini'],
  [/^kubectl\s+(delete|apply)\b/, 'modifica un cluster'],
  [/^(mv)\b/, 'può sovrascrivere file']
]

// A word that names a file or a path: where a Bash rule stops.
function isPath(word: string): boolean {
  return (
    word === '.' ||
    word === '..' ||
    word.startsWith('./') ||
    word.startsWith('../') ||
    word.startsWith('/') ||
    word.startsWith('~') ||
    (word.includes('/') && !word.startsWith('@')) ||
    /^["'`]/.test(word)
  )
}

// The leading words of a command that make its rule: the program, flags that come before the
// first subcommand, and subcommands, stopping at a path, a later flag or four words.
export function prefixOf(command: string): string {
  const words = command.trim().split(/\s+/)
  const kept: string[] = []
  let hasSubcommand = false

  for (const word of words) {
    if (kept.length >= MAX_WORDS || isPath(word)) {
      break
    }

    if (word.startsWith('-')) {
      if (hasSubcommand) {
        break
      }

      kept.push(word)
      continue
    }

    if (kept.length > 0) {
      hasSubcommand = true
    }

    kept.push(word)
  }

  return kept.join(' ')
}

function stringField(input: unknown, field: string): string | undefined {
  if (typeof input !== 'object' || input === null || !(field in input)) {
    return undefined
  }

  const value: unknown = Reflect.get(input, field)

  return typeof value === 'string' ? value : undefined
}

// What a call put to you comes to.
export function verdictOf(tool: string, input: unknown): Verdict {
  if (tool === 'Bash') {
    const command = (stringField(input, 'command') ?? '').trim()

    if (command === '') {
      return { kind: 'skip' }
    }

    const risky = RISKY.find(([pattern]) => pattern.test(command))

    if (risky !== undefined) {
      return { kind: 'risky', label: command.split('\n')[0] ?? command, reason: risky[1] }
    }

    // Chained, piped, redirected or substituted commands are more than their first word.
    if (/[;&|<>`]|\$\(/.test(command)) {
      return { kind: 'skip' }
    }

    return { kind: 'rule', rule: `Bash(${prefixOf(command)}:*)`, example: command }
  }

  if (tool === 'WebFetch') {
    const url = stringField(input, 'url')
    const host = url === undefined ? undefined : /^https?:\/\/([^/:?#]+)/i.exec(url)?.[1]

    return host === undefined
      ? { kind: 'skip' }
      : { kind: 'rule', rule: `WebFetch(domain:${host})`, example: url ?? host }
  }

  // Edits are the mode's to settle, and a question or a plan always needs you.
  if (['Edit', 'Write', 'NotebookEdit', 'AskUserQuestion', 'ExitPlanMode'].includes(tool)) {
    return { kind: 'skip' }
  }

  return { kind: 'rule', rule: tool, example: tool }
}

// Counts one approval: a rule's tally grows (keeping its latest examples), a risky call is noted.
export function countApproval(ledger: Ledger, verdict: Verdict, at: number): Ledger {
  if (verdict.kind === 'rule') {
    const before: Tally = ledger.tallies[verdict.rule] ?? { count: 0, examples: [], lastAt: 0 }
    const examples = [verdict.example, ...before.examples.filter(x => x !== verdict.example)].slice(
      0,
      EXAMPLES
    )

    return {
      ...ledger,
      tallies: {
        ...ledger.tallies,
        [verdict.rule]: { count: before.count + 1, examples, lastAt: at }
      }
    }
  }

  if (verdict.kind === 'risky') {
    const before = ledger.risky[verdict.label]?.count ?? 0

    return {
      ...ledger,
      risky: { ...ledger.risky, [verdict.label]: { count: before + 1, reason: verdict.reason } }
    }
  }

  return ledger
}

// What a refused call's result says (by you, or with nobody there to answer), so a refusal is not
// counted as an approval.
const REFUSED = /doesn't want to proceed|was rejected|has been denied|denied by the user/i

// Whether a call put to you was refused rather than approved: a hook's deny, or an error that
// says so. A command that ran and failed was still approved.
export function isRefused(result: { deny?: string; isError?: boolean; text?: string }): boolean {
  return result.deny !== undefined || (result.isError === true && REFUSED.test(result.text ?? ''))
}

// The rules ready to offer: approved at least `threshold` times, neither ignored nor added,
// the most approved first.
export function offersOf(ledger: Ledger, threshold: number): [string, Tally][] {
  const settled = new Set([...ledger.ignored, ...ledger.added.map(a => a.rule)])

  return Object.entries(ledger.tallies)
    .filter(([rule, tally]) => tally.count >= threshold && !settled.has(rule))
    .toSorted((a, b) => b[1].count - a[1].count)
}

// The settings file a scope writes to, relative to the project.
export function settingsPath(scope: Scope): string {
  return scope === 'project' ? '.claude/settings.json' : '.claude/settings.local.json'
}

// A settings file's text with `rule` added to (or, with `remove`, taken from) `permissions.allow`,
// every other setting kept; null when the text is not a JSON object, so nothing is overwritten.
export function withRule(text: string | null, rule: string, remove = false): string | null {
  let data: unknown = {}

  if (text !== null && text.trim() !== '') {
    try {
      data = JSON.parse(text)
    } catch {
      return null
    }
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null
  }

  const permissions: unknown = Reflect.get(data, 'permissions') ?? {}

  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
    return null
  }

  const allow: unknown = Reflect.get(permissions, 'allow') ?? []
  const rules = Array.isArray(allow) ? allow.filter(r => typeof r === 'string') : []
  const next = remove ? rules.filter(r => r !== rule) : [...new Set([...rules, rule])]

  return `${JSON.stringify({ ...data, permissions: { ...permissions, allow: next } }, null, 2)}\n`
}

function entriesOf(value: unknown): [string, unknown][] {
  return typeof value === 'object' && value !== null ? Object.entries(value) : []
}

// The ledger a value read back from the store holds, keeping only what is shaped right.
export function ledgerFrom(value: unknown): Ledger {
  if (typeof value !== 'object' || value === null) {
    return EMPTY_LEDGER
  }

  const read = (field: string): unknown => Reflect.get(value, field)
  const tallies: Ledger['tallies'] = {}
  const risky: Ledger['risky'] = {}

  for (const [rule, t] of entriesOf(read('tallies'))) {
    const count: unknown = typeof t === 'object' && t !== null ? Reflect.get(t, 'count') : undefined
    const examples: unknown =
      typeof t === 'object' && t !== null ? Reflect.get(t, 'examples') : undefined
    const lastAt: unknown =
      typeof t === 'object' && t !== null ? Reflect.get(t, 'lastAt') : undefined

    if (typeof count === 'number') {
      tallies[rule] = {
        count,
        examples: Array.isArray(examples) ? examples.filter(x => typeof x === 'string') : [],
        lastAt: typeof lastAt === 'number' ? lastAt : 0
      }
    }
  }

  for (const [label, r] of entriesOf(read('risky'))) {
    const count: unknown = typeof r === 'object' && r !== null ? Reflect.get(r, 'count') : undefined
    const reason: unknown =
      typeof r === 'object' && r !== null ? Reflect.get(r, 'reason') : undefined

    if (typeof count === 'number' && typeof reason === 'string') {
      risky[label] = { count, reason }
    }
  }

  const ignored = read('ignored')
  const added = read('added')

  return {
    tallies,
    risky,
    ignored: Array.isArray(ignored) ? ignored.filter(x => typeof x === 'string') : [],
    added: Array.isArray(added)
      ? added.flatMap(a => {
          const rule: unknown =
            typeof a === 'object' && a !== null ? Reflect.get(a, 'rule') : undefined
          const scope: unknown =
            typeof a === 'object' && a !== null ? Reflect.get(a, 'scope') : undefined
          const at: unknown = typeof a === 'object' && a !== null ? Reflect.get(a, 'at') : undefined

          return typeof rule === 'string' && (scope === 'project' || scope === 'local')
            ? [{ rule, scope, at: typeof at === 'number' ? at : 0 }]
            : []
        })
      : []
  }
}
