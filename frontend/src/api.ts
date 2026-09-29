export type Currency = 'EUR' | 'USD' | 'GBP' | 'JPY'
export type Kind = 'income' | 'expense' | 'refund' | 'transfer'
export type Account = { id: number; name: string; currency: Currency; archived: boolean }
export type Category = { id: number; name: string; archived: boolean }
export type Transaction = {
  id: number
  date: string
  kind: Kind
  amount_minor: number
  currency: Currency
  account_id: number
  account: string
  category_id: number | null
  category: string | null
  merchant: string
  tags: string
  note: string
  refund_of_id: number | null
  transfer_group: string | null
  direction: 'in' | 'out' | null
  demo: boolean
}
export type Totals = {
  income_minor: number
  gross_expense_minor: number
  refund_minor: number
  net_expense_minor: number
  cash_flow_minor: number
}
export type Dashboard = {
  currency: Currency
  start: string
  end: string
  previous_start: string
  previous_end: string
  current: Totals
  previous: Totals
  balance_minor: number
  account_balances: Record<string, number>
  opening_balance_minor: number
  balance_series: { date: string; balance_minor: number }[]
  months: { month: string; income_minor: number; expense_minor: number; refund_minor: number }[]
  categories: { name: string; amount_minor: number }[]
  merchants: { name: string; amount_minor: number }[]
  insights: {
    rule: string
    current_minor: number
    previous_minor: number
    start: string
    end: string
    previous_start: string
    previous_end: string
  }[]
}
export type Budget = {
  id: number
  category_id: number
  category: string
  month: string
  currency: Currency
  amount_minor: number
  actual_minor: number
  remaining_minor: number
}
export type Filters = {
  start: string
  end: string
  currency: Currency
  account_id: string
  category_id: string
  tag: string
  merchant: string
  q: string
}
export type ImportRow = {
  line: number
  status: 'valid' | 'duplicate' | 'rejected'
  reason: string
  values: Record<string, string>
  amount_minor?: number
}
export type ImportPreview = {
  sha256: string
  rows: ImportRow[]
  valid: number
  duplicate: number
  rejected: number
}

export const digits: Record<Currency, number> = { EUR: 2, USD: 2, GBP: 2, JPY: 0 }
export function money(value: number, currency: Currency) {
  const places = digits[currency]
  const scale = 10n ** BigInt(places)
  const signed = BigInt(value)
  const magnitude = signed < 0n ? -signed : signed
  const whole = magnitude / scale
  const fraction = (magnitude % scale).toString().padStart(places, '0')
  const parts = new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).formatToParts(whole)
  let lastInteger = -1
  parts.forEach((part, index) => {
    if (part.type === 'integer') lastInteger = index
  })
  const rendered = parts
    .map((part, index) => part.value + (index === lastInteger && places ? `,${fraction}` : ''))
    .join('')
  return value < 0 ? `−${rendered}` : rendered
}
export function decimalFromMinor(value: number, currency: Currency) {
  const places = digits[currency]
  const scale = 10n ** BigInt(places)
  const signed = BigInt(value)
  const magnitude = signed < 0n ? -signed : signed
  const whole = magnitude / scale
  const fraction = (magnitude % scale).toString().padStart(places, '0')
  return `${value < 0 ? '-' : ''}${whole}${places ? `.${fraction}` : ''}`
}
export function params(values: Record<string, string | undefined>) {
  const query = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value) query.set(key, value)
  })
  return query.toString()
}
export function filterParams(filters: Filters) {
  return params({ ...filters })
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options)
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body = (await response.json()) as {
        detail?: string | { msg: string }[]
        error?: string
      }
      message =
        typeof body.detail === 'string'
          ? body.detail
          : (body.error ??
            (Array.isArray(body.detail) ? body.detail.map((item) => item.msg).join(', ') : message))
    } catch {
      /* HTTP status is retained */
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}
export function jsonOptions(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
export const errorText: Record<string, string> = {
  unsupported_currency: 'Valuta non supportata.',
  unsupported_precision: 'La precisione non è valida per questa valuta.',
  amount_must_be_positive: 'Inserisci un importo maggiore di zero.',
  invalid_amount: 'Importo non valido.',
  refund_exceeds_expense: 'Il rimborso supera la spesa residua.',
  invalid_refund_reference: 'Seleziona una spesa valida nella stessa valuta.',
  expense_has_refunds:
    'Questa spesa ha rimborsi collegati. Gestiscili prima di modificarla o eliminarla.',
  category_archived: 'La categoria è archiviata.',
  account_currency_or_archive_mismatch: 'Il conto non è attivo o ha una valuta diversa.',
  transfer_currency_or_archive_mismatch: 'Scegli due conti attivi nella stessa valuta.',
  transfer_accounts_must_differ: 'Scegli due conti diversi.',
  name_exists: 'Questo nome è già presente.',
  csv_utf8_required: 'Il CSV deve essere in UTF-8.',
  csv_too_large: 'Il CSV supera 2 MB.',
  csv_content_type_required: 'Scegli un file CSV.',
  mapping_missing_required_fields: 'Mappa tutti i campi obbligatori.',
  csv_digest_mismatch: 'Il file è cambiato dopo la preview. Ripeti la preview.',
}
export function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return errorText[message] ?? message
}
