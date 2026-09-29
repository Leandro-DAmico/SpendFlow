import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'

const totals = {
  income_minor: 0,
  gross_expense_minor: 0,
  refund_minor: 0,
  net_expense_minor: 0,
  cash_flow_minor: 0,
}
const dashboard = {
  currency: 'EUR',
  start: '2026-09-01',
  end: '2026-09-30',
  previous_start: '2026-08-02',
  previous_end: '2026-08-31',
  current: totals,
  previous: totals,
  balance_minor: 0,
  opening_balance_minor: 0,
  balance_series: [{ date: '2026-09-01', balance_minor: 0 }],
  account_balances: {},
  months: [{ month: '2026-09', income_minor: 0, expense_minor: 0, refund_minor: 0 }],
  categories: [],
  merchants: [],
  insights: [],
}

describe('dashboard and navigation', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input)
        const body =
          path.includes('/accounts') ||
          path.includes('/categories') ||
          path.includes('/transactions') ||
          path.includes('/budgets')
            ? []
            : dashboard
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
      }),
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  it('renders an explicit empty period and accessible data tables', async () => {
    render(<App />)
    expect(await screen.findByText('Nessun movimento nel periodo')).toBeInTheDocument()
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Periodo precedente:/i).length).toBe(3)
  })
  it('shows the budget empty state after navigation', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Budget' }))
    await waitFor(() =>
      expect(screen.getByText('Nessun budget per questo mese')).toBeInTheDocument(),
    )
  })
})
