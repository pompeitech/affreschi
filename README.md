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

## Mod in programma

- `vesuvius-theme` — spinner e righe delle tool call nei colori del design system Vesuvius
- `file-toccati` — pannello con i file letti e modificati nel turno
- `mappa-contesto` — barra sopra il prompt con l'occupazione del contesto
