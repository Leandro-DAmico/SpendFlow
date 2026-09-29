import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, decimalFromMinor, filterParams, friendlyError, jsonOptions, money } from './api'
import type {
  Account,
  Budget,
  Category,
  Currency,
  Dashboard,
  Filters,
  ImportPreview,
  Kind,
  Transaction,
} from './api'

type Page = 'dashboard' | 'movements' | 'budgets' | 'import'
type Editor = {
  mode: 'transaction' | 'transfer' | 'budget' | 'account' | 'category'
  transaction?: Transaction
} | null
const currencies: Currency[] = ['EUR', 'USD', 'GBP', 'JPY']
const labels: Record<Kind, string> = {
  income: 'Entrata',
  expense: 'Uscita',
  refund: 'Rimborso',
  transfer: 'Trasferimento',
}
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const currentMonth = () => today().slice(0, 7)
const monthEnd = (month: string) => {
  const [year, number] = month.split('-').map(Number)
  return `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, '0')}`
}
const defaultFilters = (): Filters => ({
  start: `${currentMonth()}-01`,
  end: monthEnd(currentMonth()),
  currency: 'EUR',
  account_id: '',
  category_id: '',
  tag: '',
  merchant: '',
  q: '',
})
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`),
  )

function Icon({ name }: { name: 'grid' | 'list' | 'budget' | 'upload' | 'plus' | 'arrow' }) {
  const shapes = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    list: (
      <>
        <path d="M9 6h12M9 12h12M9 18h12" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
    budget: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5" />
        <path d="M4 16v4h16v-4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  )
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        ◎
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  )
}
function ErrorBanner({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      {retry && (
        <button type="button" className="text-button" onClick={retry}>
          Riprova
        </button>
      )}
    </div>
  )
}
function SectionTitle({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string
  title: string
  detail?: string
}) {
  return (
    <div className="section-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
    </div>
  )
}

function FilterPanel({
  filters,
  setFilters,
  accounts,
  categories,
  includeSearch = true,
}: {
  filters: Filters
  setFilters: (value: Filters) => void
  accounts: Account[]
  categories: Category[]
  includeSearch?: boolean
}) {
  const set = (key: keyof Filters, value: string) => setFilters({ ...filters, [key]: value })
  return (
    <section className="filter-panel" aria-label="Filtri combinabili">
      <div className="filter-head">
        <strong>Vista corrente</strong>
        <span>I confronti usano un periodo precedente della stessa durata.</span>
      </div>
      <div className="filter-grid">
        <label>
          Dal{' '}
          <input
            type="date"
            value={filters.start}
            max={filters.end}
            onChange={(event) => set('start', event.target.value)}
          />
        </label>
        <label>
          Al{' '}
          <input
            type="date"
            value={filters.end}
            min={filters.start}
            onChange={(event) => set('end', event.target.value)}
          />
        </label>
        <label>
          Valuta{' '}
          <select
            value={filters.currency}
            onChange={(event) =>
              setFilters({ ...filters, currency: event.target.value as Currency, account_id: '' })
            }
          >
            {currencies.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Conto{' '}
          <select
            value={filters.account_id}
            onChange={(event) => set('account_id', event.target.value)}
          >
            <option value="">Tutti i conti</option>
            {accounts
              .filter((account) => account.currency === filters.currency)
              .map((account) => (
                <option value={account.id} key={account.id}>
                  {account.name}
                  {account.archived ? ' · archiviato' : ''}
                </option>
              ))}
          </select>
        </label>
        <label>
          Categoria{' '}
          <select
            value={filters.category_id}
            onChange={(event) => set('category_id', event.target.value)}
          >
            <option value="">Tutte le categorie</option>
            {categories.map((category) => (
              <option value={category.id} key={category.id}>
                {category.name}
                {category.archived ? ' · archiviata' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tag{' '}
          <input
            value={filters.tag}
            onChange={(event) => set('tag', event.target.value)}
            placeholder="Es. viaggio"
          />
        </label>
        <label>
          Merchant{' '}
          <input
            value={filters.merchant}
            onChange={(event) => set('merchant', event.target.value)}
            placeholder="Es. mercato"
          />
        </label>
        {includeSearch && (
          <label>
            Cerca{' '}
            <input
              type="search"
              value={filters.q}
              onChange={(event) => set('q', event.target.value)}
              placeholder="Merchant, nota o tag"
            />
          </label>
        )}
      </div>
      <button className="text-button" type="button" onClick={() => setFilters(defaultFilters())}>
        Reimposta filtri
      </button>
    </section>
  )
}

function Metric({
  label,
  value,
  previous,
  currency,
  hint,
}: {
  label: string
  value: number
  previous?: number
  currency: Currency
  hint?: string
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{money(value, currency)}</strong>
      {previous !== undefined && <small>Periodo precedente: {money(previous, currency)}</small>}
      {hint && <small>{hint}</small>}
    </div>
  )
}
function BarList({
  title,
  rows,
  currency,
  empty,
}: {
  title: string
  rows: { name: string; amount_minor: number }[]
  currency: Currency
  empty: string
}) {
  const max = Math.max(1, ...rows.map((row) => Math.max(0, row.amount_minor)))
  return (
    <section className="card chart-card">
      <h3>{title}</h3>
      {rows.length ? (
        <>
          <div className="bars" aria-hidden="true">
            {rows.slice(0, 6).map((row) => (
              <div className="bar-row" key={row.name}>
                <span>{row.name}</span>
                <div className="bar-track">
                  <div style={{ width: `${(Math.max(0, row.amount_minor) / max) * 100}%` }} />
                </div>
                <b>{money(row.amount_minor, currency)}</b>
              </div>
            ))}
          </div>
          <details>
            <summary>Apri tabella dati: {title.toLowerCase()}</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Voce</th>
                    <th scope="col" className="numeric">
                      Spesa netta
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name}>
                      <th scope="row">{row.name}</th>
                      <td className="numeric">{money(row.amount_minor, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </section>
  )
}
function BalanceChart({
  rows,
  currency,
  opening,
}: {
  rows: { date: string; balance_minor: number }[]
  currency: Currency
  opening: number
}) {
  const sampled = rows.filter(
    (_, index) =>
      index === 0 ||
      index === rows.length - 1 ||
      index % Math.max(1, Math.ceil(rows.length / 90)) === 0,
  )
  const values = [opening, ...sampled.map((row) => row.balance_minor)]
  const low = Math.min(...values),
    high = Math.max(...values),
    range = Math.max(1, high - low)
  const points = sampled.map((row, index) => ({
    ...row,
    x: sampled.length === 1 ? 500 : 20 + (index / (sampled.length - 1)) * 960,
    y: 155 - ((row.balance_minor - low) / range) * 120,
  }))
  return (
    <section className="card balance-card">
      <h3>Saldo nel tempo</h3>
      <p className="muted">
        Saldo di apertura {money(opening, currency)} · variazione giornaliera fino al termine del
        periodo. Tutti i conti della valuta selezionata.
      </p>
      {points.length ? (
        <>
          <svg
            role="img"
            aria-label={`Andamento del saldo dal ${rows[0].date} al ${rows[rows.length - 1].date}`}
            viewBox="0 0 1000 180"
            preserveAspectRatio="none"
            className="balance-svg"
          >
            <line x1="20" y1="155" x2="980" y2="155" stroke="#cadad0" />
            <polyline
              points={points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke="#08776e"
              strokeWidth="4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.map((point) => (
              <circle key={point.date} cx={point.x} cy={point.y} r="5" fill="#08776e">
                <title>
                  {dateLabel(point.date)}: {money(point.balance_minor, currency)}
                </title>
              </circle>
            ))}
          </svg>
          <div className="chart-endpoints">
            <span>{dateLabel(rows[0].date)}</span>
            <span>{dateLabel(rows[rows.length - 1].date)}</span>
          </div>
          <details>
            <summary>Apri tabella del saldo giornaliero</summary>
            <div className="table-scroll daily-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col" className="numeric">
                      Saldo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.date}>
                      <th scope="row">{dateLabel(row.date)}</th>
                      <td className="numeric">{money(row.balance_minor, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="muted">Nessun giorno nel periodo.</p>
      )}
    </section>
  )
}
function DashboardPage({
  data,
  loading,
  error,
  retry,
  filters,
  accounts,
}: {
  data: Dashboard | null
  loading: boolean
  error: string
  retry: () => void
  filters: Filters
  accounts: Account[]
}) {
  if (loading)
    return (
      <div className="status" role="status">
        Caricamento dashboard…
      </div>
    )
  if (error) return <ErrorBanner message={error} retry={retry} />
  if (!data) return null
  const hasActivity = data.months.some(
    (month) => month.income_minor || month.expense_minor || month.refund_minor,
  )
  const monthlyMax = Math.max(
    1,
    ...data.months.flatMap((month) => [
      month.income_minor,
      Math.max(0, month.expense_minor - month.refund_minor),
    ]),
  )
  return (
    <div className="page-stack">
      <SectionTitle
        eyebrow="01 / Panoramica"
        title="La tua situazione, in chiaro."
        detail={`${dateLabel(data.start)} – ${dateLabel(data.end)} · ${data.currency}`}
      />
      <div className="metric-grid">
        <Metric
          label="Entrate"
          value={data.current.income_minor}
          previous={data.previous.income_minor}
          currency={data.currency}
        />
        <Metric
          label="Spesa netta"
          value={data.current.net_expense_minor}
          previous={data.previous.net_expense_minor}
          currency={data.currency}
          hint={`Spesa lorda ${money(data.current.gross_expense_minor, data.currency)} · rimborsi ${money(data.current.refund_minor, data.currency)}`}
        />
        <Metric
          label="Cash flow"
          value={data.current.cash_flow_minor}
          previous={data.previous.cash_flow_minor}
          currency={data.currency}
        />
        <Metric
          label="Saldo al termine"
          value={data.balance_minor}
          currency={data.currency}
          hint="Per valuta e conto selezionati. Include trasferimenti; gli altri filtri non cambiano il saldo."
        />
      </div>
      {!hasActivity && (
        <Empty
          title="Nessun movimento nel periodo"
          detail="Cambia periodo oppure registra una transazione. I totali zero sono corretti per questo intervallo."
        />
      )}
      <BalanceChart
        rows={data.balance_series}
        opening={data.opening_balance_minor}
        currency={data.currency}
      />
      <div className="two-columns">
        <section className="card">
          <h3>Andamento mensile</h3>
          <p className="muted">
            Valori per data civile, nella valuta selezionata. I rimborsi riducono le uscite.
          </p>
          <div className="monthly-legend" aria-label="Legenda andamento mensile">
            <span>
              <i className="income-key" /> Entrate
            </span>
            <span>
              <i className="expense-key" /> Spesa netta
            </span>
          </div>
          <div className="monthly-chart" aria-hidden="true">
            {data.months.map((month) => (
              <div className="monthly-column" key={month.month}>
                <div className="monthly-bars">
                  <div
                    className="income-bar"
                    style={{ height: `${(month.income_minor / monthlyMax) * 100}%` }}
                    title={`Entrate ${month.month}: ${money(month.income_minor, data.currency)}`}
                  />
                  <div
                    className="expense-bar"
                    style={{
                      height: `${(Math.max(0, month.expense_minor - month.refund_minor) / monthlyMax) * 100}%`,
                    }}
                    title={`Spesa netta ${month.month}: ${money(month.expense_minor - month.refund_minor, data.currency)}`}
                  />
                </div>
                <span>{month.month}</span>
              </div>
            ))}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Mese</th>
                  <th scope="col" className="numeric">
                    Entrate
                  </th>
                  <th scope="col" className="numeric">
                    Spesa netta
                  </th>
                  <th scope="col" className="numeric">
                    Cash flow
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((month) => (
                  <tr key={month.month}>
                    <th scope="row">{month.month}</th>
                    <td className="numeric">{money(month.income_minor, data.currency)}</td>
                    <td className="numeric">
                      {money(month.expense_minor - month.refund_minor, data.currency)}
                    </td>
                    <td className="numeric">
                      {money(
                        month.income_minor - month.expense_minor + month.refund_minor,
                        data.currency,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <h3>Saldo per conto</h3>
          <p className="muted">Saldo cumulato fino al {dateLabel(data.end)}.</p>
          {Object.keys(data.account_balances).length ? (
            <div className="account-list">
              {Object.entries(data.account_balances).map(([id, amount]) => (
                <div key={id}>
                  <span>
                    {accounts.find((account) => account.id === Number(id))?.name ?? `Conto #${id}`}
                  </span>
                  <strong>{money(amount, data.currency)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Nessun movimento in questa valuta.</p>
          )}
        </section>
      </div>
      <div className="two-columns">
        <BarList
          title="Per categoria"
          rows={data.categories}
          currency={data.currency}
          empty="Nessuna spesa per categoria."
        />
        <BarList
          title="Per merchant"
          rows={data.merchants}
          currency={data.currency}
          empty="Nessuna spesa per merchant."
        />
      </div>
      <section className="card">
        <h3>Insight verificabili</h3>
        {data.insights.length ? (
          data.insights.map((insight, index) => (
            <p key={index}>
              Spesa netta: {money(insight.previous_minor, data.currency)} (
              {dateLabel(insight.previous_start)}–{dateLabel(insight.previous_end)}) →{' '}
              {money(insight.current_minor, data.currency)} ({dateLabel(insight.start)}–
              {dateLabel(insight.end)}). Regola: crescita almeno 25% e 10 unità.
            </p>
          ))
        ) : (
          <p className="muted">Nessuna soglia superata nel periodo selezionato.</p>
        )}
      </section>
      {filters.category_id && (
        <p className="data-note">
          Il saldo usa tutti i movimenti del conto selezionato, anche quando è attivo un filtro
          categoria.
        </p>
      )}
    </div>
  )
}

function MovementsPage({
  transactions,
  loading,
  error,
  retry,
  onEdit,
  onDelete,
  onNew,
}: {
  transactions: Transaction[]
  loading: boolean
  error: string
  retry: () => void
  onEdit: (tx: Transaction) => void
  onDelete: (tx: Transaction) => void
  onNew: (mode: 'transaction' | 'transfer') => void
}) {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <SectionTitle
          eyebrow="02 / Registro"
          title="Ogni movimento ha una storia."
          detail="Entrate, uscite, rimborsi e trasferimenti in un unico registro."
        />
        <div className="button-row">
          <button className="button secondary" onClick={() => onNew('transfer')} type="button">
            Trasferimento
          </button>
          <button className="button primary" onClick={() => onNew('transaction')} type="button">
            <Icon name="plus" /> Movimento
          </button>
        </div>
      </div>
      {loading ? (
        <div className="status" role="status">
          Caricamento movimenti…
        </div>
      ) : error ? (
        <ErrorBanner message={error} retry={retry} />
      ) : transactions.length ? (
        <section className="card table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Movimento</th>
                  <th scope="col">Categoria / conto</th>
                  <th scope="col" className="numeric">
                    Importo
                  </th>
                  <th scope="col">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>{dateLabel(tx.date)}</td>
                    <td>
                      <strong>{tx.merchant || labels[tx.kind]}</strong>
                      <span className="table-sub">
                        {labels[tx.kind]}
                        {tx.kind === 'transfer'
                          ? ` · ${tx.direction === 'in' ? 'in entrata' : 'in uscita'}`
                          : ''}
                        {tx.demo ? ' · Demo' : ''}
                      </span>
                      {tx.note && <span className="table-sub">{tx.note}</span>}
                    </td>
                    <td>
                      {tx.category || '—'}
                      <span className="table-sub">
                        {tx.account}
                        {tx.tags && ` · #${tx.tags}`}
                      </span>
                    </td>
                    <td
                      className={`numeric amount ${tx.kind === 'income' || tx.kind === 'refund' || tx.direction === 'in' ? 'positive' : ''}`}
                    >
                      {tx.kind === 'expense' || tx.direction === 'out' ? '−' : '+'}
                      {money(tx.amount_minor, tx.currency)}
                    </td>
                    <td>
                      <div className="table-actions">
                        {tx.kind !== 'transfer' && (
                          <button className="text-button" type="button" onClick={() => onEdit(tx)}>
                            Modifica
                          </button>
                        )}
                        <button
                          className="text-button danger-text"
                          type="button"
                          onClick={() => onDelete(tx)}
                        >
                          Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <Empty
          title="Qui è tutto pronto"
          detail="Non ci sono movimenti per questi filtri. Aggiungi il primo o importa un CSV."
        />
      )}
    </div>
  )
}

function BudgetsPage({
  budgets,
  loading,
  error,
  retry,
  currency,
  setCurrency,
  month,
  setMonth,
  onNew,
  categories,
  onArchive,
}: {
  budgets: Budget[]
  loading: boolean
  error: string
  retry: () => void
  currency: Currency
  setCurrency: (currency: Currency) => void
  month: string
  setMonth: (month: string) => void
  onNew: () => void
  categories: Category[]
  onArchive: (category: Category) => void
}) {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <SectionTitle
          eyebrow="03 / Pianificazione"
          title="Budget con il contesto giusto."
          detail="Ogni budget vale per un mese civile, una categoria e una valuta."
        />
        <button className="button primary" type="button" onClick={onNew}>
          <Icon name="plus" /> Budget
        </button>
      </div>
      <div className="inline-filter">
        <label>
          Mese{' '}
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <label>
          Valuta{' '}
          <select
            aria-label="Valuta budget"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
          >
            {(['EUR', 'USD', 'GBP', 'JPY'] as Currency[]).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <div className="status" role="status">
          Caricamento budget…
        </div>
      ) : error ? (
        <ErrorBanner message={error} retry={retry} />
      ) : budgets.length ? (
        <div className="budget-grid">
          {budgets.map((budget) => {
            const ratio = Math.max(
              0,
              Math.min(100, (budget.actual_minor / budget.amount_minor) * 100),
            )
            return (
              <article className="card budget-card" key={budget.id}>
                <div className="budget-top">
                  <h3>{budget.category}</h3>
                  <span>{budget.month.slice(0, 7)}</span>
                </div>
                <div className="budget-values">
                  <strong>{money(budget.actual_minor, currency)}</strong>
                  <span>di {money(budget.amount_minor, currency)}</span>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label={`Budget ${budget.category}`}
                  aria-valuemin={0}
                  aria-valuemax={budget.amount_minor}
                  aria-valuenow={Math.max(0, budget.actual_minor)}
                >
                  <div style={{ width: `${ratio}%` }} />
                </div>
                <p className={budget.remaining_minor < 0 ? 'over-budget' : 'muted'}>
                  {budget.remaining_minor < 0
                    ? `${money(-budget.remaining_minor, currency)} oltre il budget`
                    : `${money(budget.remaining_minor, currency)} disponibili`}
                </p>
              </article>
            )
          })}
        </div>
      ) : (
        <Empty
          title="Nessun budget per questo mese"
          detail="Imposta un limite mensile per una categoria e confrontalo con la spesa netta."
        />
      )}
      <section className="card">
        <h3>Categorie</h3>
        <p className="muted">
          Le categorie archiviate restano nello storico e non possono essere usate per nuovi
          movimenti.
        </p>
        <div className="category-list">
          {categories.length ? (
            categories.map((category) => (
              <div key={category.id}>
                <span>
                  {category.name}
                  {category.archived && <small> · archiviata</small>}
                </span>
                {!category.archived && (
                  <button className="text-button" type="button" onClick={() => onArchive(category)}>
                    Archivia
                  </button>
                )}
              </div>
            ))
          ) : (
            <p className="muted">Nessuna categoria. Creane una dal menu Aggiungi.</p>
          )}
        </div>
      </section>
    </div>
  )
}

const mappingFields = [
  ['date', 'Data *'],
  ['kind', 'Tipo *'],
  ['amount', 'Importo *'],
  ['currency', 'Valuta *'],
  ['account', 'Conto *'],
  ['category', 'Categoria'],
  ['merchant', 'Merchant'],
  ['tags', 'Tag'],
  ['note', 'Nota'],
] as const
function parseHeader(text: string): string[] {
  const line = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const character = line[i]
    if (character === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (character === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else cell += character
  }
  cells.push(cell)
  return cells
}
function ImportPage({ onImported, filters }: { onImported: () => void; filters: Filters }) {
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [report, setReport] = useState<{
    imported: number
    skipped: number
    rejected: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const chooseFile = async (next: File | null) => {
    setFile(next)
    setPreview(null)
    setReport(null)
    setSelected([])
    setError('')
    if (!next) {
      setHeaders([])
      setMapping({})
      return
    }
    if (next.size > 2 * 1024 * 1024) {
      setError('Il CSV supera 2 MB.')
      return
    }
    const first = parseHeader(await next.text())
    setHeaders(first)
    setMapping(
      Object.fromEntries(
        mappingFields.map(([field]) => [
          field,
          first.find((name) => name.trim().toLowerCase() === field) ?? '',
        ]),
      ),
    )
  }
  const formData = (confirm = false) => {
    const form = new FormData()
    form.append('file', file!)
    form.append(
      'mapping',
      JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, value]) => value))),
    )
    if (confirm && preview) {
      form.append('sha256', preview.sha256)
      form.append('selected', JSON.stringify(selected))
    }
    return form
  }
  const runPreview = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    setReport(null)
    try {
      const result = await api<ImportPreview>('/import/preview', {
        method: 'POST',
        body: formData(),
      })
      setPreview(result)
      setSelected(result.rows.filter((row) => row.status === 'valid').map((row) => row.line))
    } catch (cause) {
      setError(friendlyError(cause))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }
  const confirm = async () => {
    if (!file || !preview) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ imported: number; skipped: number; rejected: number }>(
        '/import/confirm',
        { method: 'POST', body: formData(true) },
      )
      setReport(result)
      setPreview(null)
      onImported()
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusy(false)
    }
  }
  const download = async (format: 'csv' | 'json') => {
    setExportBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/export/${format}?${filterParams(filters)}`)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const blob = await response.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `spendflow.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setExportBusy(false)
    }
  }
  return (
    <div className="page-stack">
      <SectionTitle
        eyebrow="04 / Portabilità"
        title="I dati restano tuoi."
        detail="Importa con controllo riga per riga; esporta i movimenti filtrati in CSV o JSON."
      />
      <div className="two-columns import-layout">
        <section className="card">
          <h3>Importa CSV</h3>
          <p className="muted">
            UTF-8 · massimo 2 MB e 10.000 righe. I conti e le categorie indicati nel CSV devono
            esistere. La preview non salva dati.
          </p>
          <p className="data-note">
            La deduplica confronta data, tipo, importo, valuta, conto, categoria e merchant, tag e
            nota normalizzati. Due acquisti davvero identici possono risultare duplicati: controlla
            gli scarti nella preview.
          </p>
          <label>
            File CSV{' '}
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {file && headers.length > 0 && (
            <>
              <h4>Mappa le colonne</h4>
              <div className="mapping-grid">
                {mappingFields.map(([field, label]) => (
                  <label key={field}>
                    {label}
                    <select
                      value={mapping[field] ?? ''}
                      onChange={(event) => {
                        setMapping({ ...mapping, [field]: event.target.value })
                        setPreview(null)
                      }}
                    >
                      <option value="">Non mappato</option>
                      {headers.map((header, index) => (
                        <option value={header} key={`${header}-${index}`}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button
                className="button primary"
                type="button"
                disabled={busy || mappingFields.slice(0, 5).some(([field]) => !mapping[field])}
                onClick={() => void runPreview()}
              >
                {busy ? 'Analisi…' : 'Mostra preview'}
              </button>
            </>
          )}
        </section>
        <section className="card">
          <h3>Esporta</h3>
          <p className="muted">
            L’export applica i filtri correnti. Il CSV neutralizza testi che iniziano con =, +, - o
            @ per evitare formule nei fogli di calcolo.
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              type="button"
              disabled={exportBusy}
              onClick={() => void download('csv')}
            >
              Scarica CSV
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={exportBusy}
              onClick={() => void download('json')}
            >
              Scarica JSON
            </button>
          </div>
          <p className="data-note">
            Filtro: {filters.start} → {filters.end} · {filters.currency}
          </p>
        </section>
      </div>
      {error && <ErrorBanner message={error} />}
      {report && (
        <div className="success-banner" role="status">
          Import completato: {report.imported} importati, {report.skipped} saltati,{' '}
          {report.rejected} scartati.
        </div>
      )}
      {preview && (
        <section className="card">
          <div className="page-heading">
            <div>
              <h3>Preview · nessun dato salvato</h3>
              <p>
                {preview.valid} validi · {preview.duplicate} duplicati · {preview.rejected} scartati
              </p>
            </div>
            <button
              className="button primary"
              type="button"
              disabled={busy || !selected.length}
              onClick={() => void confirm()}
            >
              {busy ? 'Importazione…' : `Conferma ${selected.length} righe`}
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Includi</th>
                  <th scope="col">Riga</th>
                  <th scope="col">Esito</th>
                  <th scope="col">Data / tipo</th>
                  <th scope="col">Merchant</th>
                  <th scope="col">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line}>
                    <td>
                      {row.status === 'valid' ? (
                        <input
                          type="checkbox"
                          aria-label={`Includi riga ${row.line}`}
                          checked={selected.includes(row.line)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...selected, row.line]
                                : selected.filter((line) => line !== row.line),
                            )
                          }
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{row.line}</td>
                    <td>
                      <span className={`pill ${row.status}`}>
                        {row.status === 'valid'
                          ? 'Valida'
                          : row.status === 'duplicate'
                            ? 'Duplicata'
                            : 'Scartata'}
                      </span>
                    </td>
                    <td>
                      {row.values.date || '—'} · {row.values.kind || '—'}
                    </td>
                    <td>{row.values.merchant || '—'}</td>
                    <td>{row.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function EditorDialog({
  editor,
  accounts,
  categories,
  currency,
  budgetMonth,
  close,
  saved,
}: {
  editor: Exclude<Editor, null>
  accounts: Account[]
  categories: Category[]
  currency: Currency
  budgetMonth: string
  close: () => void
  saved: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const tx = editor.transaction
  const [kind, setKind] = useState<Exclude<Kind, 'transfer'>>(
    tx?.kind === 'income' || tx?.kind === 'refund' ? tx.kind : 'expense',
  )
  const [date, setDate] = useState(tx?.date ?? today())
  const [amount, setAmount] = useState(tx ? decimalFromMinor(tx.amount_minor, tx.currency) : '')
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(tx?.currency ?? currency)
  const [accountId, setAccountId] = useState(String(tx?.account_id ?? ''))
  const [toAccountId, setToAccountId] = useState('')
  const [categoryId, setCategoryId] = useState(String(tx?.category_id ?? ''))
  const [merchant, setMerchant] = useState(tx?.merchant ?? '')
  const [tags, setTags] = useState(tx?.tags ?? '')
  const [note, setNote] = useState(tx?.note ?? '')
  const [refundOfId, setRefundOfId] = useState(String(tx?.refund_of_id ?? ''))
  const [name, setName] = useState('')
  const [expenses, setExpenses] = useState<Transaction[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const node = dialog.current
    if (node && !node.open) node.showModal()
  }, [])
  useEffect(() => {
    if (editor.mode === 'transaction' && kind === 'refund') {
      void api<Transaction[]>(`/transactions?currency=${selectedCurrency}`)
        .then((items) => setExpenses(items.filter((item) => item.kind === 'expense')))
        .catch(() => setExpenses([]))
    }
  }, [editor.mode, kind, selectedCurrency])
  const availableAccounts = accounts.filter(
    (account) => !account.archived && account.currency === selectedCurrency,
  )
  const availableCategories = categories.filter(
    (category) => !category.archived || category.id === tx?.category_id,
  )
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (editor.mode === 'transaction') {
        const payload = {
          date,
          kind,
          amount,
          currency: selectedCurrency,
          account_id: Number(accountId),
          category_id: categoryId ? Number(categoryId) : null,
          merchant,
          tags,
          note,
          refund_of_id: kind === 'refund' && refundOfId ? Number(refundOfId) : null,
        }
        await api(
          tx ? `/transactions/${tx.id}` : '/transactions',
          jsonOptions(tx ? 'PUT' : 'POST', payload),
        )
      } else if (editor.mode === 'transfer') {
        await api(
          '/transfers',
          jsonOptions('POST', {
            date,
            amount,
            currency: selectedCurrency,
            from_account_id: Number(accountId),
            to_account_id: Number(toAccountId),
            note,
          }),
        )
      } else if (editor.mode === 'budget') {
        await api(
          '/budgets',
          jsonOptions('POST', {
            category_id: Number(categoryId),
            month: `${budgetMonth}-01`,
            currency: selectedCurrency,
            amount,
          }),
        )
      } else if (editor.mode === 'account') {
        await api('/accounts', jsonOptions('POST', { name, currency: selectedCurrency }))
      } else {
        await api('/categories', jsonOptions('POST', { name }))
      }
      saved()
      close()
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusy(false)
    }
  }
  const title =
    editor.mode === 'transaction'
      ? tx
        ? 'Modifica movimento'
        : 'Nuovo movimento'
      : editor.mode === 'transfer'
        ? 'Nuovo trasferimento'
        : editor.mode === 'budget'
          ? 'Imposta budget'
          : editor.mode === 'account'
            ? 'Nuovo conto'
            : 'Nuova categoria'
  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="dialog-title"
      onClose={close}
      onCancel={close}
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="dialog-head">
          <div>
            <span className="eyebrow">SpendFlow / Modifica dati</span>
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button
            className="close-button"
            type="button"
            aria-label="Chiudi finestra"
            onClick={close}
          >
            ×
          </button>
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="dialog-fields">
          {editor.mode === 'transaction' && (
            <label>
              Tipo{' '}
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as Exclude<Kind, 'transfer'>)
                  setRefundOfId('')
                }}
              >
                <option value="expense">Uscita</option>
                <option value="income">Entrata</option>
                <option value="refund">Rimborso</option>
              </select>
            </label>
          )}
          {(editor.mode === 'transaction' || editor.mode === 'transfer') && (
            <label>
              Data civile{' '}
              <input
                type="date"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          )}
          {(editor.mode === 'account' || editor.mode === 'category') && (
            <label>
              Nome{' '}
              <input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={editor.mode === 'account' ? 'Es. Conto corrente' : 'Es. Casa'}
              />
            </label>
          )}
          {editor.mode !== 'category' && (
            <label>
              Valuta{' '}
              <select
                value={selectedCurrency}
                onChange={(event) => {
                  setSelectedCurrency(event.target.value as Currency)
                  setAccountId('')
                  setToAccountId('')
                }}
                disabled={Boolean(tx)}
              >
                {currencies.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}
          {(editor.mode === 'transaction' ||
            editor.mode === 'transfer' ||
            editor.mode === 'budget') && (
            <label>
              Importo ({selectedCurrency}){' '}
              <input
                required
                type="number"
                inputMode="decimal"
                min={selectedCurrency === 'JPY' ? '1' : '0.01'}
                step={selectedCurrency === 'JPY' ? '1' : '0.01'}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder={selectedCurrency === 'JPY' ? '1000' : '25.00'}
              />
            </label>
          )}
          {(editor.mode === 'transaction' || editor.mode === 'transfer') && (
            <label>
              {editor.mode === 'transfer' ? 'Conto di origine' : 'Conto'}{' '}
              <select
                required
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                <option value="">Seleziona un conto</option>
                {availableAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {editor.mode === 'transfer' && (
            <label>
              Conto di destinazione{' '}
              <select
                required
                value={toAccountId}
                onChange={(event) => setToAccountId(event.target.value)}
              >
                <option value="">Seleziona un conto</option>
                {availableAccounts
                  .filter((account) => String(account.id) !== accountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {((editor.mode === 'transaction' && kind !== 'income') || editor.mode === 'budget') && (
            <label>
              Categoria{' '}
              <select
                required
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">Seleziona una categoria</option>
                {availableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.archived ? ' · archiviata' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {editor.mode === 'transaction' && kind === 'refund' && (
            <label>
              Spesa collegata{' '}
              <select
                value={refundOfId}
                onChange={(event) => {
                  const id = event.target.value
                  setRefundOfId(id)
                  const original = expenses.find((item) => item.id === Number(id))
                  if (original) setCategoryId(String(original.category_id ?? ''))
                }}
              >
                <option value="">Rimborso senza collegamento</option>
                {expenses.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.id} · {dateLabel(item.date)} · {item.merchant || item.category} ·{' '}
                    {money(item.amount_minor, item.currency)}
                  </option>
                ))}
              </select>
              <small>
                Se disponibile, collega la spesa originale: il rimborso ne riduce il netto.
              </small>
            </label>
          )}
          {editor.mode === 'transaction' && (
            <>
              <label>
                Merchant{' '}
                <input
                  maxLength={160}
                  value={merchant}
                  onChange={(event) => setMerchant(event.target.value)}
                  placeholder="Es. Mercato"
                />
              </label>
              <label>
                Tag{' '}
                <input
                  maxLength={300}
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="Es. famiglia, ricorrente"
                />
              </label>
            </>
          )}
          {(editor.mode === 'transaction' || editor.mode === 'transfer') && (
            <label className="full-field">
              Nota{' '}
              <textarea
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Dettagli facoltativi"
              />
            </label>
          )}
        </div>
        {editor.mode === 'transfer' && (
          <p className="data-note">
            I trasferimenti spostano saldo fra conti della stessa valuta e non entrano nel cash
            flow.
          </p>
        )}
        {editor.mode === 'budget' && (
          <p className="data-note">
            Mese: {budgetMonth}. Un budget esistente per la stessa categoria viene aggiornato.
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={close}>
            Annulla
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [filters, setFilters] = useState<Filters>(defaultFilters)
  const [budgetMonth, setBudgetMonth] = useState(currentMonth())
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<Editor>(null)
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)
  const [undoId, setUndoId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const [demoBusy, setDemoBusy] = useState(false)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const query = useMemo(() => filterParams(filters), [filters])
  useEffect(() => {
    let alive = true
    Promise.all([api<Account[]>('/accounts'), api<Category[]>('/categories')])
      .then(([nextAccounts, nextCategories]) => {
        if (alive) {
          setAccounts(nextAccounts)
          setCategories(nextCategories)
        }
      })
      .catch((cause) => {
        if (alive) setError(friendlyError(cause))
      })
    return () => {
      alive = false
    }
  }, [revision])
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    const request =
      page === 'dashboard'
        ? api<Dashboard>(`/dashboard?${query}`).then((value) => {
            if (alive) setDashboard(value)
          })
        : page === 'movements'
          ? api<Transaction[]>(`/transactions?${query}`).then((value) => {
              if (alive) setTransactions(value)
            })
          : page === 'budgets'
            ? api<Budget[]>(`/budgets?month=${budgetMonth}-01&currency=${filters.currency}`).then(
                (value) => {
                  if (alive) setBudgets(value)
                },
              )
            : Promise.resolve()
    request
      .catch((cause) => {
        if (alive) setError(friendlyError(cause))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [page, query, budgetMonth, filters.currency, revision])
  const deleteTransaction = async () => {
    if (!deleteTarget) return
    try {
      await api(`/transactions/${deleteTarget.id}`, { method: 'DELETE' })
      setUndoId(deleteTarget.id)
      setNotice('Movimento eliminato. Puoi ripristinarlo.')
      setDeleteTarget(null)
      refresh()
    } catch (cause) {
      setNotice(friendlyError(cause))
      setDeleteTarget(null)
    }
  }
  const restore = async () => {
    if (undoId === null) return
    try {
      await api(`/transactions/${undoId}/restore`, { method: 'POST' })
      setUndoId(null)
      setNotice('Movimento ripristinato.')
      refresh()
    } catch (cause) {
      setNotice(friendlyError(cause))
    }
  }
  const archive = async (category: Category) => {
    if (
      !window.confirm(
        `Archivia la categoria “${category.name}”? I movimenti storici resteranno visibili.`,
      )
    )
      return
    try {
      await api(`/categories/${category.id}/archive`, { method: 'POST' })
      setNotice('Categoria archiviata.')
      refresh()
    } catch (cause) {
      setNotice(friendlyError(cause))
    }
  }
  const seedDemo = async () => {
    setDemoBusy(true)
    try {
      const result = await api<{ added: number; message: string }>('/demo', { method: 'POST' })
      setNotice(result.message)
      refresh()
    } catch (cause) {
      setNotice(friendlyError(cause))
    } finally {
      setDemoBusy(false)
    }
  }
  const nav: { id: Page; text: string; icon: 'grid' | 'list' | 'budget' | 'upload' }[] = [
    { id: 'dashboard', text: 'Dashboard', icon: 'grid' },
    { id: 'movements', text: 'Movimenti', icon: 'list' },
    { id: 'budgets', text: 'Budget', icon: 'budget' },
    { id: 'import', text: 'Import / Export', icon: 'upload' },
  ]
  return (
    <>
      <a className="skip-link" href="#main">
        Vai al contenuto
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-symbol" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div>
              <strong>SpendFlow</strong>
              <small>Finanze, con prospettiva.</small>
            </div>
          </div>
          <nav aria-label="Navigazione principale">
            {nav.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`nav-link ${page === item.id ? 'active' : ''}`}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={() => setPage(item.id)}
              >
                <Icon name={item.icon} />
                <span className="nav-label">{item.text}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="privacy-note">
              <span className="privacy-dot"></span>
              <strong>Privato per progetto</strong>
              <small>I dati restano su questo dispositivo.</small>
            </div>
            <button
              className="text-button"
              type="button"
              disabled={demoBusy}
              onClick={() => void seedDemo()}
            >
              {demoBusy ? 'Caricamento demo…' : 'Aggiungi dati demo sintetici'}
            </button>
          </div>
        </aside>
        <div className="main-area">
          <header className="topbar">
            <div className="topbar-title">
              <span className="eyebrow">Personal finance workspace</span>
              <h1>{nav.find((item) => item.id === page)?.text}</h1>
            </div>
            <div className="top-actions">
              <button
                className="button subtle"
                type="button"
                onClick={() => setEditor({ mode: 'account' })}
              >
                + Conto
              </button>
              <button
                className="button subtle"
                type="button"
                onClick={() => setEditor({ mode: 'category' })}
              >
                + Categoria
              </button>
              <button
                className="button primary"
                type="button"
                onClick={() => setEditor({ mode: 'transaction' })}
              >
                <Icon name="plus" /> Nuovo
              </button>
            </div>
          </header>
          <main id="main">
            <div className="content-wrap">
              {page !== 'budgets' && (
                <FilterPanel
                  filters={filters}
                  setFilters={setFilters}
                  accounts={accounts}
                  categories={categories}
                />
              )}
              {page === 'dashboard' && (
                <DashboardPage
                  data={dashboard}
                  loading={loading}
                  error={error}
                  retry={refresh}
                  filters={filters}
                  accounts={accounts}
                />
              )}
              {page === 'movements' && (
                <MovementsPage
                  transactions={transactions}
                  loading={loading}
                  error={error}
                  retry={refresh}
                  onEdit={(tx) => setEditor({ mode: 'transaction', transaction: tx })}
                  onDelete={setDeleteTarget}
                  onNew={(mode) => setEditor({ mode })}
                />
              )}
              {page === 'budgets' && (
                <BudgetsPage
                  budgets={budgets}
                  loading={loading}
                  error={error}
                  retry={refresh}
                  currency={filters.currency}
                  setCurrency={(currency) => setFilters({ ...filters, currency })}
                  month={budgetMonth}
                  setMonth={setBudgetMonth}
                  onNew={() => setEditor({ mode: 'budget' })}
                  categories={categories}
                  onArchive={(category) => void archive(category)}
                />
              )}
              {page === 'import' && <ImportPage onImported={refresh} filters={filters} />}
              <footer>SpendFlow · Locale per default · Nessuna connessione bancaria</footer>
            </div>
          </main>
        </div>
      </div>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          {undoId !== null && (
            <button type="button" onClick={() => void restore()}>
              Annulla eliminazione
            </button>
          )}
          <button
            type="button"
            aria-label="Chiudi notifica"
            onClick={() => {
              setNotice('')
              setUndoId(null)
            }}
          >
            ×
          </button>
        </div>
      )}
      {editor && (
        <EditorDialog
          key={`${editor.mode}-${editor.transaction?.id ?? 'new'}`}
          editor={editor}
          accounts={accounts}
          categories={categories}
          currency={filters.currency}
          budgetMonth={budgetMonth}
          close={() => setEditor(null)}
          saved={refresh}
        />
      )}
      {deleteTarget && (
        <div className="confirm-backdrop">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            aria-describedby="delete-detail"
            className="confirm-box"
          >
            <h2 id="delete-title">Eliminare il movimento?</h2>
            <p id="delete-detail">
              {deleteTarget.kind === 'transfer'
                ? 'Entrambi i movimenti del trasferimento saranno rimossi.'
                : `Il movimento del ${dateLabel(deleteTarget.date)} sarà rimosso.`}{' '}
              Potrai ripristinarlo dal messaggio successivo.
            </p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setDeleteTarget(null)}
              >
                Annulla
              </button>
              <button
                className="button danger"
                type="button"
                onClick={() => void deleteTransaction()}
              >
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
