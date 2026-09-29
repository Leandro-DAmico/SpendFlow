# Verifica eseguita

Ambiente: Windows, Python 3.12, Node 20.11.0, npm 10.2.4. Data: 2026-09-23. I comandi sono stati eseguiti dalla cartella indicata; i risultati seguenti riportano solo controlli completati.

| Area | Comando | Esito osservato |
|---|---|---|
| Installazione backend | `py -3.12 -m venv .venv`; `.\.venv\Scripts\python.exe -m pip install -e '.[dev]'` | Completata. Primo tentativo fallito per discovery di `alembic` come package; corretto `pyproject.toml` e reinstallato. |
| Migrazione | `.\.venv\Scripts\alembic.exe upgrade head` | Applicata revisione `0001` su SQLite locale. |
| Ruff lint | `.\.venv\Scripts\ruff.exe check ledgerlens tests alembic` | `All checks passed!` |
| Ruff format | `.\.venv\Scripts\ruff.exe format --check ledgerlens tests alembic` | `12 files already formatted`. |
| mypy strict | `.\.venv\Scripts\mypy.exe --strict ledgerlens` | `Success: no issues found in 6 source files` |
| Pytest + Hypothesis | `.\.venv\Scripts\python.exe -m pytest -q` | `19 passed, 1 warning`; warning di deprecazione TestClient/Starlette. Include regressioni per modifica dopo import e soglia JPY. |
| API reale | `.\.venv\Scripts\uvicorn.exe ledgerlens.api:app --host 127.0.0.1 --port 8000` | Processo avviato; `/api/health` → `ok`, `/openapi.json` → titolo `LedgerLens API`. |
| Installazione frontend | `npm install` | Completata; `package-lock.json` prodotto. |
| Frontend lint, formato, build, componenti | `npm run check` | Passato: ESLint, Prettier, TypeScript/Vite build, Vitest `5 passed`. Rieseguito dopo le correzioni UI. |
| Playwright E2E | `npm run test:e2e` | `1 passed` con API e Vite reali su DB migrato pulito. Copre budget, spesa/rimborso/trasferimento, CSV valido/duplicato/malformato, conferma parziale, export CSV/JSON, formula injection, input negativo, valuta non supportata, mese vuoto, cambio anno, categoria archiviata. Asserisce nessun errore JS e nessuna risposta API 5xx. Rieseguito dopo la review. |
| Pre-commit | `backend\.venv\Scripts\pre-commit.exe run --all-files` con venv in `PATH` | Passati Ruff lint, Ruff format e controllo frontend. |
| Audit dipendenze di produzione | `npm audit --omit=dev --audit-level=moderate` | `found 0 vulnerabilities`. |
| Git diff | `git diff --check` | Exit 0; solo avvisi LF→CRLF di Git su Windows. |
| Git staged diff | `git diff --cached --check` | Exit 0; nessun whitespace error. |

## Browser reale e screenshot

Con Playwright CLI in Chromium su Vite/API reali ho caricato la demo sintetica in un DB SQLite migrato separato e salvato [`dashboard-desktop.png`](screenshots/dashboard-desktop.png) (1440 px) e [`dashboard-mobile.png`](screenshots/dashboard-mobile.png) (390 px). QA visiva ha individuato nav mobile troncata; corretta e ricatturata. `document.documentElement.scrollWidth <= window.innerWidth` a 390 px → `true`.

Ho caricato nel browser la fixture fisica [`demo-import.csv`](../fixtures/demo-import.csv): mapping automatico verificato, preview `3 validi · 0 duplicati · 1 scartati`, riga negativa con motivo `amount_must_be_positive`; ho deselezionato una riga valida e confermato: `2 importati, 1 saltati, 1 scartati`. Una nuova preview ha mostrato `1 validi · 2 duplicati · 1 scartati`. Screenshot reale: [`import-preview.png`](screenshots/import-preview.png). Il test E2E verifica separatamente download CSV/JSON e neutralizzazione della formula con contenuto letto dalle risposte API.

Una nuova sessione Chromium dopo la correzione favicon ha mostrato `Errors: 0, Warnings: 0`; le richieste API registrate dalla dashboard erano solo verso `127.0.0.1:5173/api/...`, tutte HTTP 200. Nessuna richiesta a servizi terzi osservata. Il test E2E controlla gli errori JavaScript e risposte 5xx lungo il percorso completo.

Al termine ho fermato i processi locali su 8000 e 5173 e rimosso i tre DB SQLite sintetici usati per QA e screenshot. Il primo avvio dell'utente applica la migrazione su un DB nuovo; nessun dato di QA è distribuito.

Review read-only finale con agente `gpt-6-sol` high: tre rilievi fondati (impronta CSV dopo modifica, soglia insight JPY, filtri budget ignorati). Corretti e verificati con 2 test backend aggiuntivi, check frontend, browser e E2E.

## Limite ambiente

`docker --version` in PowerShell: comando `docker` non riconosciuto. `docker compose up --build` non è stato eseguito. Compose e Dockerfile sono presenti, ma non verificati su questo computer.

`npm audit --audit-level=moderate` segnala 5 vulnerabilità nelle dipendenze di sviluppo del toolchain Vite/Vitest/esbuild (3 moderate, 1 high, 1 critical); richiede aggiornamenti maggiori. L'audit limitato alle dipendenze di produzione non segnala vulnerabilità. I dev server sono legati al loopback nei comandi locali. Aggiornare Node/toolchain e riverificare prima di usare un ambiente di sviluppo non fidato.

`git commit -m "Build LedgerLens local-first expense tracker"` è stato tentato dopo lo staging dei 53 file previsti, ma Git ha risposto `Author identity unknown` / `fatal: unable to auto-detect email address`. Non ho inventato un'identità autore; il branch locale è `main`, i file sono staged, non esiste commit né remote, e non è stato fatto push. Prima della pubblicazione, configurare nome/email Git desiderati, ricontrollare lo staged diff e creare il commit.
