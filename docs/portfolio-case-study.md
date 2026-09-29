# LedgerLens — case study

## Il problema

Un tracker di spese è poco utile se somma valute diverse, trasforma i rimborsi in entrate o conta due volte i trasferimenti. LedgerLens affronta queste ambiguità nel modello dati e mostra i numeri insieme alle regole che li producono.

## La soluzione realizzata

Ho costruito un monolite locale con FastAPI, React e SQLite. Ogni importo nativo è un intero in unità minime; tipo e direzione definiscono il segno. La dashboard separa spesa lorda, rimborsi, spesa netta, cash-flow e saldo. I budget usano data civile e spesa netta. I grafici hanno dati tabellari equivalenti.

## Qualità dati e privacy

L'import CSV offre mapping, preview, validazione per riga, selezione intenzionale e report scarti. Un'impronta normalizzata individua duplicati, con il limite esplicito degli acquisti identici. L'export CSV neutralizza i testi che potrebbero diventare formule; JSON conserva i valori originali. I dati restano sul computer dell'utente e non sono inviati a servizi esterni.

## Ingegneria e compromessi

Migrazione Alembic, proprietà monetarie con Hypothesis, test API e controlli statici rendono le invarianti verificabili. SQLite semplifica la demo locale; lo schema e l'ORM evitano tipi specifici del database. Non ho introdotto tassi di cambio: senza una fonte verificabile, la dashboard richiede una valuta. Il saldo iniziale è zero e i newline incorporati nel CSV non sono supportati. Il prodotto non si collega a banche.

## Stato

Le evidenze dei controlli realmente eseguiti, con eventuali limiti dell'ambiente, sono in [verification.md](verification.md). Non attribuisco utenti, performance o benefici quantitativi non misurati.
