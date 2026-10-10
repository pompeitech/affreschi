# affreschi

Mod di interfaccia per Claude Code, raccolte in un marketplace privato di pompeitech.
Come gli affreschi decoravano le pareti delle domus, queste mod decorano l'interfaccia di Claude Code.

## Struttura

```
affreschi/
├── .claude-plugin/marketplace.json   # elenco delle mod
└── plugins/
    └── <nome-mod>/                   # una cartella (un plugin) per ogni mod
        ├── .claude-plugin/plugin.json
        └── hooks/
            ├── hooks.json
            └── register.js
```

## Aggiungere una mod

1. Crea la cartella `plugins/<nome-mod>/` con i suoi file.
2. Aggiungila all'array `plugins` di `.claude-plugin/marketplace.json`:

   ```json
   { "name": "<nome-mod>", "source": "./plugins/<nome-mod>", "description": "..." }
   ```

3. Controlla che sia valida: `claude plugin validate ./plugins/<nome-mod>`

## Sviluppo

Carica una mod solo per la sessione corrente (si ricarica quando salvi):

```bash
claude --plugin-dir ./plugins/<nome-mod>
```

## Installazione

```bash
/plugin marketplace add pompeitech/affreschi
/plugin install <nome-mod>@affreschi
```

## Le mod

| Mod | Cosa fa | Dove si vede |
| --- | --- | --- |
| `vesuvius-theme` | Spinner con il bagliore del cratere e parole vulcaniche, una colata di colore accanto a ogni tool call (magma mentre gira, lava se fallisce, cenere a fine corsa), e la riga di fine turno come eruzione (`▲ Eruttato per 1m 4s`) | Terminale; sul desktop solo le righe delle tool call |
| `file-toccati` | `/file-toccati` apre un pannello con i file letti (`R`) e modificati (`M`, con `+`/`-`) nel turno; premi un file per vederne il diff. A fine turno un toast ricorda quanti file sono cambiati | Terminale e desktop |
| `mappa-contesto` | Banda sopra il prompt con il contesto diviso per categoria, percentuale che passa da tufo a magma a lava oltre il 60% e l'85%, e `dettagli` per la legenda | Terminale e desktop |

## La palette

I colori stanno in `hooks/vesuvius.ts` di ogni mod (un plugin non può importare file di un altro, quindi è copiato in tutte e tre). Sono provvisori: vanno sostituiti con quelli del design system Vesuvius.

## Test

```bash
claude plugin validate ./plugins/<nome-mod>
claude plugin test ./plugins/<nome-mod>
```
