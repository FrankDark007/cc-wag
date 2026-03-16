import { describe, it, expect } from 'vitest'
import { classifyMessage } from '../src/features/model-router.js'

describe('classifyMessage', () => {
  it('routes greetings to Haiku', () => {
    const result = classifyMessage('hi')
    expect(result.model).toContain('haiku')
  })

  it('routes short messages to Haiku', () => {
    const result = classifyMessage('yes')
    expect(result.model).toContain('haiku')
  })

  it('routes slash commands to Haiku', () => {
    const result = classifyMessage('/status')
    expect(result.model).toContain('haiku')
  })

  it('routes analysis requests to Opus', () => {
    const result = classifyMessage('analyze the insurance claim for Smith')
    expect(result.model).toContain('opus')
  })

  it('routes code requests to Opus', () => {
    const result = classifyMessage('debug the intake bot feature')
    expect(result.model).toContain('opus')
  })

  it('routes long messages to Opus', () => {
    const words = Array(55).fill('word').join(' ')
    const result = classifyMessage(words)
    expect(result.model).toContain('opus')
  })

  it('routes medium messages to Sonnet', () => {
    const result = classifyMessage('send a message to the team about tomorrow meeting')
    expect(result.model).toContain('sonnet')
  })

  it('returns model and reason', () => {
    const result = classifyMessage('hello')
    expect(result).toHaveProperty('model')
    expect(result).toHaveProperty('reason')
  })
})
