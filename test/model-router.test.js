import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { classifyMessage } from '../src/features/model-router.js'

describe('classifyMessage', () => {
  let origAtlas

  beforeEach(() => {
    origAtlas = process.env.ATLAS_MODEL
    delete process.env.ATLAS_MODEL // premium tier should default to SDK latest (null)
  })

  afterEach(() => {
    if (origAtlas === undefined) delete process.env.ATLAS_MODEL
    else process.env.ATLAS_MODEL = origAtlas
  })

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

  // ── Premium tier (default — SDK latest model, model = null) ──

  it('routes medium messages to premium/SDK-default (model null)', () => {
    const result = classifyMessage('send a message to the team about tomorrow meeting')
    expect(result.model).toBeNull()
    expect(result.reason).toBe('default')
  })

  it('routes drafting requests to premium/SDK-default', () => {
    const result = classifyMessage('write me a quick email to the client')
    expect(result.model).toBeNull()
    expect(result.reason).toBe('default')
  })

  it('routes analysis requests to premium (reason complex)', () => {
    const result = classifyMessage('analyze the insurance claim for Smith')
    expect(result.model).toBeNull()
    expect(result.reason).toBe('complex')
  })

  it('routes very long messages to premium (reason long)', () => {
    const words = Array(155).fill('word').join(' ')
    const result = classifyMessage(words)
    expect(result.model).toBeNull()
    expect(result.reason).toBe('long')
  })

  it('never routes premium tier to Sonnet', () => {
    const result = classifyMessage('plan the schedule for next week')
    expect(result.model ?? '').not.toContain('sonnet')
  })

  // ── ATLAS_MODEL override ──

  it('respects ATLAS_MODEL override for premium tier', () => {
    process.env.ATLAS_MODEL = 'claude-opus-4-8'
    const result = classifyMessage('analyze the insurance claim for Smith')
    expect(result.model).toBe('claude-opus-4-8')
    expect(result.reason).toBe('complex')
  })

  it('override does not affect Haiku tier', () => {
    process.env.ATLAS_MODEL = 'claude-opus-4-8'
    const result = classifyMessage('hi')
    expect(result.model).toContain('haiku')
  })

  // ── Structure ──

  it('returns model and reason', () => {
    const result = classifyMessage('hello')
    expect(result).toHaveProperty('model')
    expect(result).toHaveProperty('reason')
  })
})
