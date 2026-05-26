import { describe, it, expect } from 'vitest'
import { classifyMessage } from '../src/features/model-router.js'

describe('classifyMessage', () => {
  // ── Haiku tier (greetings, short messages, commands) ──

  it('routes greetings to Haiku', () => {
    const result = classifyMessage('hi')
    expect(result.model).toContain('haiku')
    expect(result.reason).toBe('greeting')
  })

  it('routes short messages to Haiku', () => {
    const result = classifyMessage('yes')
    expect(result.model).toContain('haiku')
  })

  it('routes slash commands to Haiku', () => {
    const result = classifyMessage('/status')
    expect(result.model).toContain('haiku')
    expect(result.reason).toBe('command')
  })

  it('routes multi-word greetings to Haiku (up to 8 words)', () => {
    const result = classifyMessage('hey thanks for the update')
    expect(result.model).toContain('haiku')
  })

  // ── Opus tier (default — most messages) ──

  it('routes medium messages to Opus (default)', () => {
    const result = classifyMessage('send a message to the team about tomorrow meeting')
    expect(result.model).toContain('opus')
    expect(result.reason).toBe('default')
  })

  it('routes drafting requests to Opus (default)', () => {
    const result = classifyMessage('write me a quick email to the client')
    expect(result.model).toContain('opus')
    expect(result.reason).toBe('default')
  })

  it('routes code requests to Opus (default)', () => {
    const result = classifyMessage('debug the intake bot feature')
    expect(result.model).toContain('opus')
    expect(result.reason).toBe('default')
  })

  it('routes planning requests to Opus (default)', () => {
    const result = classifyMessage('plan the schedule for next week')
    expect(result.model).toContain('opus')
    expect(result.reason).toBe('default')
  })

  // ── Opus tier (genuine analysis only) ──

  it('routes analysis requests to Opus', () => {
    const result = classifyMessage('analyze the insurance claim for Smith')
    expect(result.model).toContain('opus')
    expect(result.reason).toBe('complex')
  })

  it('routes xactimate/scope requests to Opus', () => {
    const result = classifyMessage('review the xactimate scope sheet for the Smith job')
    expect(result.model).toContain('opus')
  })

  it('routes very long messages to Opus (150+ words)', () => {
    const words = Array(155).fill('word').join(' ')
    const result = classifyMessage(words)
    expect(result.model).toContain('opus')
    expect(result.reason).toBe('long')
  })

  it('routes 55-word messages to Opus (default)', () => {
    const words = Array(55).fill('word').join(' ')
    const result = classifyMessage(words)
    expect(result.model).toContain('opus')
    expect(result.reason).toBe('default')
  })

  // ── Structure ──

  it('returns model and reason', () => {
    const result = classifyMessage('hello')
    expect(result).toHaveProperty('model')
    expect(result).toHaveProperty('reason')
  })
})
