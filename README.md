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
| `touched-files` | `/touched-files` opens a pane listing the files read (`R`) and edited (`M`, with `+`/`-`) this turn; press a file to see its diff. At the end of a turn a toast says how many files changed | Terminal and desktop |
| `agent-usage` | `/agent-usage` opens a live pane (it polls every 2s while an agent runs) where the main conversation and each subagent stand as a pixel mascot whose eyes follow its status, beside the tokens it consumed and its share, teammates and agents started before the mod loaded included; press a row for model, input/output/cache tokens, requests, tool calls and run time. The status line shows the subagents running, and a toast says what each one consumed when it finishes | Terminal and desktop |
| `pulcinella` | The band above the prompt: Pulcinella in pixel art, animated (he hammers while a tool runs, blinks, snores), beside the context window, read again after every model request: the tokens used, the headroom before compaction (vineyard green, then magma and lava past 60% and 85% of the threshold), an estimate of the turns left at the recent pace, the window split by category in one bar, and the largest categories as chips (`hide`/`legend` toggles them). `details` or `/context-map` opens a pane with every category's tokens and share, the auto-compact threshold, and what fills the window: memory files, MCP servers, custom agents, skills He frets when a command fails, cheers green tests, gasps at changes of 300+ lines, naps after ten quiet minutes, and his line in Neapolitan sits under the bar. His hat grows a level with the tokens you spend (1M, 10M, 50M, 200M), kept across sessions | Terminal and desktop |

## The palette

The colors live in each mod's `hooks/palette.ts` (a plugin cannot import another plugin's files, so each keeps a copy). They are placeholders, to be replaced with the Vesuvius design system's.

## Tests

```bash
claude plugin validate ./plugins/<mod-name>
claude plugin test ./plugins/<mod-name>
npx -y @biomejs/biome@2.2.4 check plugins
```

Code follows the officina standards: Biome in StandardJS style (`biome.json`), braced blocks set off by blank lines, no `as` casts beyond `as const` (values the engine hands over as `unknown` are narrowed by checks), and failures logged to the debug log with `$.ui.log(..., { to: 'debug' })`, never swallowed.
