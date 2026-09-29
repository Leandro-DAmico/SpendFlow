import { describe, expect, it } from 'vitest'
import { decimalFromMinor, filterParams, friendlyError, money } from './api'

describe('financial display', () => {
  it('uses currency-specific minor digits', () => {
    expect(money(12345, 'EUR')).toContain('123,45')
    expect(money(12345, 'JPY')).toContain('12.345')
    expect(decimalFromMinor(12345, 'EUR')).toBe('123.45')
    expect(decimalFromMinor(12345, 'JPY')).toBe('12345')
    expect(decimalFromMinor(9000000000000000, 'EUR')).toBe('90000000000000.00')
  })
  it('keeps all combined filters for API requests', () => {
    const query = filterParams({
      start: '2026-01-01',
      end: '2026-01-31',
      currency: 'EUR',
      account_id: '4',
      category_id: '7',
      tag: 'trip',
      merchant: 'market',
      q: 'lunch',
    })
    const values = new URLSearchParams(query)
    expect(values.get('account_id')).toBe('4')
    expect(values.get('category_id')).toBe('7')
    expect(values.get('tag')).toBe('trip')
    expect(values.get('merchant')).toBe('market')
    expect(values.get('q')).toBe('lunch')
  })
  it('explains domain errors in Italian', () => {
    expect(friendlyError(new Error('unsupported_precision'))).toContain('precisione')
  })
})
