import type { Day, Days } from '../types'

// The ledger: days by date, what a turn adds to one, the week they fall in, and what the
// budget says about it. Times come in as milliseconds, so the clock stays the caller's.

const DAY_MS = 24 * 60 * 60 * 1000
// Days older than this are dropped from the store.
const KEEP_DAYS = 90
const WEEKDAYS = ['do', 'lu', 'ma', 'me', 'gi', 've', 'sa'] as const

export const EMPTY_DAY: Day = { usd: 0, tokens: 0, projects: {} }

const pad = (n: number): string => String(n).padStart(2, '0')

// The date a moment falls on, as `2026-10-25`.
export function dayKey(ms: number): string {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// The short name of a moment's weekday (`lu`, `ma`…).
export function weekdayOf(ms: number): string {
  return WEEKDAYS[new Date(ms).getDay()] ?? ''
}

// The seven days up to and including `ms`'s, oldest first, each with its date and record.
export function lastWeek(days: Days, ms: number): { at: number; key: string; day: Day }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const at = ms - (6 - i) * DAY_MS
    const key = dayKey(at)

    return { at, key, day: days[key] ?? EMPTY_DAY }
  })
}

// Adds a turn's cost and tokens to its day under its project, and drops the days past keeping.
export function record(
  days: Days,
  ms: number,
  add: { usd: number; tokens: number; project: string }
): Days {
  const key = dayKey(ms)
  const day = days[key] ?? EMPTY_DAY
  const oldest = dayKey(ms - KEEP_DAYS * DAY_MS)
  const kept = Object.fromEntries(Object.entries(days).filter(([k]) => k >= oldest))

  return {
    ...kept,
    [key]: {
      usd: day.usd + add.usd,
      tokens: day.tokens + add.tokens,
      projects: { ...day.projects, [add.project]: (day.projects[add.project] ?? 0) + add.usd }
    }
  }
}

export function sumOf(week: readonly { day: Day }[]): { usd: number; tokens: number } {
  return week.reduce((t, { day }) => ({ usd: t.usd + day.usd, tokens: t.tokens + day.tokens }), {
    usd: 0,
    tokens: 0
  })
}

// The week's cost by project, the most expensive first.
export function projectsOf(week: readonly { day: Day }[]): [string, number][] {
  const totals = new Map<string, number>()

  for (const { day } of week) {
    for (const [project, usd] of Object.entries(day.projects)) {
      totals.set(project, (totals.get(project) ?? 0) + usd)
    }
  }

  return [...totals].toSorted((a, b) => b[1] - a[1])
}

// The highest budget mark (80 or 100, in percent) a spend has reached; 0 below both or with no
// budget.
export function markOf(spent: number, budget: number): 0 | 80 | 100 {
  if (budget <= 0) {
    return 0
  }

  const percent = (spent / budget) * 100

  return percent >= 100 ? 100 : percent >= 80 ? 80 : 0
}

// The days a value read back from the store holds, keeping only entries shaped like a day.
export function daysFrom(value: unknown): Days {
  if (typeof value !== 'object' || value === null) {
    return {}
  }

  const days: Days = {}

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }

    const usd = 'usd' in entry ? entry.usd : undefined
    const tokens = 'tokens' in entry ? entry.tokens : undefined
    const projects = 'projects' in entry ? entry.projects : undefined

    if (typeof usd === 'number' && typeof tokens === 'number') {
      days[key] = {
        usd,
        tokens,
        projects:
          typeof projects === 'object' && projects !== null
            ? Object.fromEntries(
                Object.entries(projects).filter(
                  (pair): pair is [string, number] => typeof pair[1] === 'number'
                )
              )
            : {}
      }
    }
  }

  return days
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }

  if (n >= 10_000) {
    return `${Math.round(n / 1000)}k`
  }

  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`
  }

  return String(n)
}
