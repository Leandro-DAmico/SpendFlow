# Sicurezza e privacy

- Dati finanziari in SQLite locale; bind API su `127.0.0.1`. Nessuna telemetria, integrazione bancaria, font remoto o chiamata a servizi terzi prevista. SQLite non è cifrato: proteggere il profilo del sistema operativo e fare backup del file fuori dal repository.
- Le richieste di scrittura con `Origin` diverso dall'origine frontend configurata sono respinte. CORS ammette solo quell'origine. L'app è destinata a uso individuale su computer fidato, senza autenticazione simulata.
- CSV: `text/csv`, `application/csv` o tipo Excel CSV; UTF-8/BOM; massimo 2 MiB letti a blocchi e 10.000 righe dati, 40 colonne, campi al massimo 1000 caratteri. Riga malformata → scarto con numero linea; newline incorporati nei campi non supportati.
- Preview senza mutazioni. Conferma con file identico (SHA-256), mapping e righe valide selezionate. Scrittura atomica; vincolo unico sull'impronta. L'impronta usa data, tipo, unità minime, valuta, conto, categoria e testi normalizzati. Due acquisti identici possono essere interpretati come duplicati.
- CSV export aggiunge un apostrofo ai valori testuali che iniziano, anche dopo whitespace, con `=`, `+`, `-`, `@`. Questo altera intenzionalmente il CSV per ridurre il rischio di formula injection in fogli di calcolo. JSON mantiene il testo originale. L'app non valuta formule.
- La cancellazione dei movimenti è soft delete con ripristino. Non archivia né cancella in cascata categorie storiche. Il seed demo è sintetico, etichettato e additivo.
- `.gitignore` esclude DB, backup, `.env` e build. Le fixture nel repository sono sintetiche.
