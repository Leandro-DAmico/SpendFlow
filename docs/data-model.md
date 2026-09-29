# Modello dati

| Tabella | Campi principali | Vincoli |
|---|---|---|
| `accounts` | `id`, `name`, `currency`, `archived` | nome unico, conto a valuta unica |
| `categories` | `id`, `name`, `archived` | nome unico; archiviazione senza perdita storico |
| `transactions` | data civile, `kind`, `amount_minor`, valuta, conto, categoria, merchant, tag, nota | importo positivo; FK verso conto/categoria; impronta CSV unica |
| `budgets` | categoria, primo giorno del mese, valuta, `amount_minor` | tripla categoria/mese/valuta unica |

I trasferimenti sono due righe `transactions` con lo stesso `transfer_group`, una `direction=out`, una `direction=in`; vengono create e cancellate insieme. I rimborsi usano `refund_of_id` quando è nota la spesa originale. `deleted=true` conserva i movimenti eliminati per il ripristino. `demo=true` identifica dati sintetici.

`amount_minor > 0` e la valuta definiscono il valore; il segno contabile è derivato da `kind` e, per i trasferimenti, da `direction`. La funzione centrale `to_minor` accetta una stringa decimale, applica `ROUND_HALF_UP` esplicitamente e rifiuta precisione oltre l'esponente della valuta. EUR/USD/GBP hanno 2 decimali; JPY zero. Importi zero/negativi e valute ignote sono invalidi. Non si aggregano valute diverse.

La data è civile, priva di timezone. Un budget di gennaio copre `[1 gennaio, 1 febbraio)`; il confronto precedente usa lo stesso numero di giorni. I saldi partono da zero e includono i trasferimenti, mentre la spesa netta è `expense - refund` e il cash-flow è `income - expense + refund`.
