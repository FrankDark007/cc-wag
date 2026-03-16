import { describe, it, expect } from 'vitest'
import { formatDate, formatMoney, formatMoneyDollars, formatDateShort, daysUntil, daysAgo, isOverdue, statusEmoji, makeJobId, addDays, findJobInData } from '../src/utils/job-data.js'

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2026-03-15T12:00:00.000Z')
    expect(result).toContain('Mar')
    expect(result).toContain('15')
    expect(result).toContain('2026')
  })

  it('returns dash for null', () => {
    expect(formatDate(null)).toBe('\u2014')
  })

  it('returns dash for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('\u2014')
  })
})

describe('formatMoney', () => {
  it('formats cents to dollars', () => {
    expect(formatMoney(150000)).toBe('$1,500.00')
  })

  it('handles null', () => {
    expect(formatMoney(null)).toBe('$0.00')
  })
})

describe('formatMoneyDollars', () => {
  it('formats dollar amount', () => {
    expect(formatMoneyDollars(1500)).toBe('$1,500.00')
  })
})

describe('makeJobId', () => {
  it('pads to 3 digits', () => {
    expect(makeJobId(1)).toBe('FD-001')
    expect(makeJobId(42)).toBe('FD-042')
    expect(makeJobId(100)).toBe('FD-100')
  })
})

describe('addDays', () => {
  it('adds days to a date', () => {
    const result = addDays('2026-03-15T00:00:00.000Z', 10)
    expect(result).toContain('2026-03-25')
  })

  it('handles month overflow', () => {
    const result = addDays('2026-03-25T00:00:00.000Z', 10)
    expect(result).toContain('2026-04-04')
  })
})

describe('findJobInData', () => {
  const data = {
    jobs: [
      { id: 'FD-001', client: 'Alice' },
      { id: 'FD-042', client: 'Bob' }
    ]
  }

  it('finds by full ID', () => {
    expect(findJobInData(data, 'FD-001').client).toBe('Alice')
  })

  it('finds by number string', () => {
    expect(findJobInData(data, '42').client).toBe('Bob')
  })

  it('is case-insensitive', () => {
    expect(findJobInData(data, 'fd-001').client).toBe('Alice')
  })

  it('returns null for missing', () => {
    expect(findJobInData(data, 'FD-999')).toBeNull()
  })
})

describe('daysUntil', () => {
  it('returns positive for future dates', () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString()
    expect(daysUntil(future)).toBeGreaterThanOrEqual(4)
    expect(daysUntil(future)).toBeLessThanOrEqual(6)
  })

  it('returns Infinity for null', () => {
    expect(daysUntil(null)).toBe(Infinity)
  })
})

describe('isOverdue', () => {
  it('returns true for past dates', () => {
    expect(isOverdue('2020-01-01T00:00:00.000Z')).toBe(true)
  })

  it('returns false for future dates', () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    expect(isOverdue(future)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isOverdue(null)).toBe(false)
  })
})

describe('statusEmoji', () => {
  it('returns emoji for known statuses', () => {
    expect(statusEmoji('active')).toBeTruthy()
    expect(statusEmoji('paid')).toBeTruthy()
  })

  it('returns default for unknown status', () => {
    expect(statusEmoji('unknown')).toBeTruthy()
  })
})
