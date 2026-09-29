Ho costruito **LedgerLens**, un expense tracker locale per esplorare un problema di data modeling che sembra semplice solo finché non arrivano rimborsi, trasferimenti e più valute.

Gli importi sono interi in unità minime. I rimborsi riducono la spesa netta; i trasferimenti spostano saldo fra conti senza gonfiare entrate o uscite. Non eseguo conversioni di valuta senza tassi e fonte: i report restano separati per valuta.

Ho curato anche la qualità dei dati: import CSV con mapping e preview per riga, deduplica dichiarata, conferma selettiva e report scarti. L'export CSV neutralizza testi che un foglio elettronico potrebbe interpretare come formule. La UI mostra i numeri dei grafici anche in tabelle accessibili.

Stack: FastAPI, SQLAlchemy/Alembic, SQLite, React/TypeScript. Il repository include test, CI, documentazione e una demo interamente sintetica. I dati finanziari restano locali per default.

Il progetto documenta anche i suoi limiti, tra cui l'assenza di connessioni bancarie e di conversione valutaria. Codice e screenshot sono pronti per essere pubblicati dopo la revisione finale del repository.
