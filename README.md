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
| `context-map` | A band above the prompt with the context window split by category, a percentage that turns from tuff to magma to lava past 60% and 85%, and `details` for the legend | Terminal and desktop |

## The palette

The colors live in each mod's `hooks/palette.ts` (a plugin cannot import another plugin's files, so all three keep a copy). They are placeholders, to be replaced with the Vesuvius design system's.

## Tests

```bash
claude plugin validate ./plugins/<mod-name>
claude plugin test ./plugins/<mod-name>
```
