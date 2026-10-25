# affreschi

Claude Code interface mods, collected in a private pompeitech marketplace.
Just as frescoes decorated the walls of Pompeii's houses, these mods decorate Claude Code's interface.

## Layout

```
affreschi/
├── .claude-plugin/marketplace.json   # the list of mods
└── plugins/
    └── <mod-name>/                   # one folder (one plugin) per mod
        ├── .claude-plugin/plugin.json
        ├── hooks/
        │   ├── hooks.json
        │   ├── palette.ts            # Vesuvius colors
        │   └── register.tsx
        ├── types/index.d.ts          # the mod's $.state contract, when it has one
        └── tests/
```

## Adding a mod

1. Create the folder `plugins/<mod-name>/` with its files.
2. Add it to the `plugins` array in `.claude-plugin/marketplace.json`:

   ```json
   { "name": "<mod-name>", "source": "./plugins/<mod-name>", "description": "..." }
   ```

3. Check it: `claude plugin validate ./plugins/<mod-name>`

## Development

Load a mod for the current session only (it reloads when you save):

```bash
claude --plugin-dir ./plugins/<mod-name>
```

## Installing

```bash
/plugin marketplace add pompeitech/affreschi
/plugin install <mod-name>@affreschi
```

## The mods

| Mod | What it does | Where it shows |
| --- | --- | --- |
| `vesuvius-theme` | A spinner with a glowing crater and volcanic words, a stripe of color beside every tool call (magma while it runs, lava when it fails, ash once done), and the end-of-turn line as an eruption (`▲ Erupted for 1m 4s`) | Terminal; on the desktop, only the tool call rows |
| `agent-usage` | `/agent-usage` opens a live pane (it polls every 2s while an agent runs) where every agent plays a character cast from its type or name: Pulcinella for the main conversation, the artist (beret and brush) for frontend and UI work, the nerd (glasses) for planners and architects, the explorer (head lamp), the reviewer (monocle), the guard (helmet) for security, the tester (lab mask) and the handyman (flat cap) for the rest; their eyes follow the status. *In scena* holds the main conversation, the agents at work and the ones that did something this turn; at the next prompt the finished ones move to the *archivio*, one row per role with count, tokens and failures (▸ opens it, `svuota archivio` clears it and keeps its tokens in the totals). Press a name for model, input/output/cache tokens, requests, tool calls and run time. Teammates and agents started before the mod loaded are listed too. The status line shows the subagents running, and a toast says what each one consumed when it finishes | Terminal and desktop |
| `pulcinella` | The band above the prompt: Pulcinella in pixel art, animated (he hammers while a tool runs, blinks, snores), beside the context window, read again after every model request: the tokens used, the headroom before compaction (vineyard green, then magma and lava past 60% and 85% of the threshold), an estimate of the turns left at the recent pace, the window split by category in one bar, and the largest categories as chips (`hide`/`legend` toggles them). `details` or `/context-map` opens a pane with every category's tokens and share, the auto-compact threshold, and what fills the window: memory files, MCP servers, custom agents, skills He frets when a command fails, cheers green tests, gasps at changes of 300+ lines, naps after ten quiet minutes, and his line in Neapolitan sits under the bar. His hat grows a level with the tokens you spend (1M, 10M, 50M, 200M), kept across sessions | Terminal and desktop |
| `maschere` | `/maschera` opens a picker (or `/maschera arlecchino` puts one on at once) and Claude answers in that mask's voice: Pulcinella warm and ironic with a Neapolitan word now and then, Arlecchino as terse as it gets, Balanzone thorough with the reasons and trade-offs. Only the tone changes: the mask's section goes last in the system prompt and says every other instruction wins. The mask worn shows in the status line and is remembered for the next session | Terminal and desktop |
| `spaccanapoli` | A row above the prompt with the git branch and its base, commits ahead and behind, files changed with lines added and removed (and a bar of the two), and the branch's PR from `gh` (open, draft, mergeable, conflicts). Changes made right on the base branch turn it into a red warning. Read again every 10s, after every tool that can change files and at the end of a turn; outside a repository it stays away. Next to `pulcinella` each keeps the other's band | Terminal and desktop |
| `golfo` | `/golfo` opens Il Golfo: the last seven days as bars of cost and tokens, today and the priciest day picked out, and the week's cost by project, recorded across sessions (90 days kept). With a `weeklyBudget` set in the plugin's options, a bar shows how much of it is spent, and a toast warns at 80% and 100% | Terminal and desktop |
| `lazzarone` | When Claude has been waiting on you for `minutes` (3 by default, in the plugin's options): a permission, a question, a plan to approve, or a turn of two minutes or more just finished, a system notification says what it waits for. One call per wait; answering or writing a prompt clears them | Terminal and desktop |

## The palette

The colors live in each mod's `hooks/palette.ts` (a plugin cannot import another plugin's files, so each keeps a copy). They are placeholders, to be replaced with the Vesuvius design system's.

## Tests

```bash
claude plugin validate ./plugins/<mod-name>
claude plugin test ./plugins/<mod-name>
npx -y @biomejs/biome@2.2.4 check plugins
```

Code follows the officina standards: Biome in StandardJS style (`biome.json`), braced blocks set off by blank lines, no `as` casts beyond `as const` (values the engine hands over as `unknown` are narrowed by checks), and failures logged to the debug log with `$.ui.log(..., { to: 'debug' })`, never swallowed.
