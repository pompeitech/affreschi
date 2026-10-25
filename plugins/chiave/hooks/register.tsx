import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { Added, Ledger, Scope } from '../types'
import { VESUVIUS } from './palette'
import {
  countApproval,
  EMPTY_LEDGER,
  isRefused,
  ledgerFrom,
  offersOf,
  settingsPath,
  type Verdict,
  verdictOf,
  withRule
} from './rules'

const PANE = 'chiave'
const KEY = '#F2C14E'
const BADGE_TEXT = '#1A1A1A'

const ledger = atom({ plugin: 'chiave', key: 'ledger' } as const, EMPTY_LEDGER)

// The module's own: the project, and the calls put to you that are still waiting for an answer.
let cwd = ''
const pending = new Map<string, Verdict>()

const storeKey = (): string => `ledger:${cwd}`

function logFailure($: EngineInterface, what: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  $.ui.log(`chiave: ${what} failed: ${reason}`, { to: 'debug' })
}

async function save($: EngineInterface, change: (l: Ledger) => Ledger): Promise<Ledger> {
  const next = change(await read($, ledger))
  await update($, ledger, () => next)
  await $.store.set(storeKey(), next)

  return next
}

// Writes `rule` into (or, with `remove`, out of) a settings file. Refuses to touch a file that is
// not plain JSON, and says so.
async function writeRule(
  $: EngineInterface,
  rule: string,
  scope: Scope,
  remove = false
): Promise<boolean> {
  const path = settingsPath(scope)
  // From the session's project, not from wherever the process runs.
  const file = `${cwd}/${path}`
  const text = (await $.fs.exists(file)) ? await $.fs.read(file) : null
  const next = withRule(typeof text === 'string' ? text : null, rule, remove)

  if (next === null) {
    $.ui.toast(`Chiave: ${path} non è JSON valido, non l'ho toccato`)

    return false
  }

  await $.fs.write(file, next)

  return true
}

async function allow($: EngineInterface, rule: string, scope: Scope): Promise<void> {
  if (await writeRule($, rule, scope)) {
    const at = await $.clock.now()
    await save($, l => ({ ...l, added: [...l.added, { rule, scope, at }] }))
    $.ui.toast(`⚿ ${rule} consentito in ${settingsPath(scope)}`)
  }
}

async function ignore($: EngineInterface, rule: string): Promise<void> {
  await save($, l => ({ ...l, ignored: [...l.ignored, rule] }))
}

async function takeBack($: EngineInterface, added: Added): Promise<void> {
  if (await writeRule($, added.rule, added.scope, true)) {
    await save($, l => ({ ...l, added: l.added.filter(a => a.rule !== added.rule) }))
    $.ui.toast(`⚿ ${added.rule} tolto da ${settingsPath(added.scope)}`)
  }
}

export const register: Register = (on, options) => {
  const threshold =
    typeof options.threshold === 'number' && options.threshold >= 1
      ? Math.floor(options.threshold)
      : 3

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    pending.clear()
    await $.command.register({
      name: 'chiave',
      description: 'Open Chiave: the rules you keep approving, ready to allow for good',
      immediate: true
    })
    const stored = ledgerFrom(await $.store.get(storeKey()))
    await update($, ledger, () => stored)

    return next(e)
  })

  on('command.run', { command: 'chiave' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Chiave', focus: true, closeOnEscape: true })

    return {}
  })

  // A call put to you: remembered until it is answered, with a line under the dialog that keeps
  // the count, or says why it will never be offered.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)

    if (verdict.decision !== 'ask' || e.tool_use_id === undefined) {
      return verdict
    }

    const seen = verdictOf(e.tool, e.input)
    pending.set(e.tool_use_id, seen)
    const count =
      seen.kind === 'rule' ? ((await read($, ledger)).tallies[seen.rule]?.count ?? 0) + 1 : 0
    const line =
      seen.kind === 'risky'
        ? `⚿ Chiave · non lo proporrò come regola: ${seen.reason}`
        : seen.kind === 'rule' && count >= 2
          ? `⚿ Chiave · ${count}ª volta su ${threshold} che approvi ${seen.rule}`
          : undefined

    if (line !== undefined) {
      try {
        $.ui.notice(e.tool_use_id, line)
      } catch (error) {
        logFailure($, 'showing the count under the dialog', error)
      }
    }

    return verdict
  })

  // The call went ahead: you approved it, so it counts; a refusal does not.
  on('tool.call', async ($, e, next) => {
    try {
      const result = await next(e)
      const seen = pending.get(e.tool_use_id)

      if (seen !== undefined && !isRefused(result)) {
        const at = await $.clock.now()
        const updated = await save($, l => countApproval(l, seen, at))

        if (seen.kind === 'rule' && updated.tallies[seen.rule]?.count === threshold) {
          $.ui.toast(`⚿ Chiave · nuova regola pronta: ${seen.rule} · /chiave`)
        }
      }

      return result
    } finally {
      pending.delete(e.tool_use_id)
    }
  })

  // The pane: the rules to offer, the risky calls never offered, and the rules already added.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const l = await read($, ledger)
    const offers = offersOf(l, threshold)
    const risky = Object.entries(l.risky).toSorted((a, b) => b[1].count - a[1].count)
    const total = Object.values(l.tallies).reduce((sum, t) => sum + t.count, 0)
    const project = cwd.split('/').filter(Boolean).at(-1) ?? cwd

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text color={KEY}>⚿</Text> <Text bold>Chiave</Text>
            <Text color={VESUVIUS.ash}>
              {' '}
              · {project} · {total} {total === 1 ? 'approvazione contata' : 'approvazioni contate'}
            </Text>
          </Text>
          <Text color={VESUVIUS.ash}>soglia {threshold}</Text>
        </Box>
        <Text color={VESUVIUS.ash}>PROPOSTE</Text>
        {offers.length === 0 && (
          <Text color={VESUVIUS.ash}>
            Ancora niente: una regola compare qui quando la approvi {threshold} volte.
          </Text>
        )}
        {offers.map(([rule, tally]) => (
          <Box flexDirection="column" borderStyle="round" borderColor={VESUVIUS.ash} paddingX={1}>
            <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
              <Text mono bold wrap="truncate-end">
                {rule}
              </Text>
              <Text color={KEY}>
                {'●'.repeat(Math.min(tally.count, 8))}{' '}
                <Text color={VESUVIUS.ash}>{tally.count} volte</Text>
              </Text>
            </Box>
            {tally.examples.length > 0 && (
              <Text mono color={VESUVIUS.ash} wrap="truncate-end">
                es. {tally.examples.join(' · ')}
              </Text>
            )}
            <Box flexDirection="row" columnGap={1}>
              <Button
                key={`project-${rule}`}
                label="Consenti nel progetto"
                onPress={() => allow($, rule, 'project')}
              />
              <Button
                key={`local-${rule}`}
                label="Solo per me"
                onPress={() => allow($, rule, 'local')}
              />
              <Button key={`ignore-${rule}`} plain label="Ignora" onPress={() => ignore($, rule)} />
            </Box>
          </Box>
        ))}
        {risky.length > 0 && (
          <Box flexDirection="column">
            <Text color={VESUVIUS.ash}>
              NON LE PROPONGO · troppo rischiose da consentire sempre
            </Text>
            {risky.map(([label, r]) => (
              <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
                <Text mono color={VESUVIUS.lava} wrap="truncate-end">
                  {label}
                </Text>
                <Text color={VESUVIUS.ash}>
                  {r.reason} · approvato {r.count} {r.count === 1 ? 'volta' : 'volte'}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        {l.added.length > 0 && (
          <Box flexDirection="column">
            <Text color={VESUVIUS.ash}>GIÀ AGGIUNTE DA CHIAVE</Text>
            {l.added.map(a => (
              <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
                <Text mono wrap="truncate-end">
                  {a.rule}
                </Text>
                <Box flexDirection="row" columnGap={1}>
                  <Text
                    backgroundColor={a.scope === 'project' ? KEY : VESUVIUS.ash}
                    color={BADGE_TEXT}
                  >
                    {a.scope === 'project' ? ' progetto ' : ' solo io '}
                  </Text>
                  <Button
                    key={`remove-${a.rule}`}
                    plain
                    label="togli"
                    onPress={() => takeBack($, a)}
                  />
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
