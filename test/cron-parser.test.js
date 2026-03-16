import { describe, it, expect } from 'vitest'
import { getScheduler } from '../src/tools/cron.js'

describe('getNextCronRun', () => {
  const scheduler = getScheduler()

  it('parses daily 9am expression', () => {
    const next = scheduler.getNextCronRun('0 9 * * *')
    expect(next).toBeInstanceOf(Date)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
  })

  it('parses hourly expression', () => {
    const next = scheduler.getNextCronRun('30 * * * *')
    expect(next).toBeInstanceOf(Date)
    expect(next.getMinutes()).toBe(30)
  })

  it('parses weekday-only expression', () => {
    const next = scheduler.getNextCronRun('0 9 * * 1-5')
    expect(next).toBeInstanceOf(Date)
    const day = next.getDay()
    expect(day).toBeGreaterThanOrEqual(1)
    expect(day).toBeLessThanOrEqual(5)
  })

  it('parses monthly expression', () => {
    const next = scheduler.getNextCronRun('0 0 1 * *')
    expect(next).toBeInstanceOf(Date)
    expect(next.getDate()).toBe(1)
  })

  it('returns null for invalid expression', () => {
    const next = scheduler.getNextCronRun('invalid cron')
    expect(next).toBeNull()
  })

  it('returns a future date', () => {
    const next = scheduler.getNextCronRun('0 9 * * *')
    expect(next.getTime()).toBeGreaterThan(Date.now())
  })
})
