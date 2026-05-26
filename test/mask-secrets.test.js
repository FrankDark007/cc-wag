import { describe, it, expect } from 'vitest'
import { maskValue, maskObject, isSecretKey, scrubSecrets } from '../src/utils/mask-secrets.js'

describe('maskValue', () => {
  it('returns empty string for null/undefined', () => {
    expect(maskValue(null)).toBe('')
    expect(maskValue(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(maskValue('')).toBe('')
  })

  it('fully masks short values (<=8 chars)', () => {
    expect(maskValue('abc')).toBe('****')
    expect(maskValue('12345678')).toBe('****')
  })

  it('keeps prefix and suffix for longer values', () => {
    const result = maskValue('sk-ant-abcdef1234567890xyz')
    expect(result).toBe('sk-a****0xyz')
    expect(result).not.toContain('abcdef')
  })

  it('coerces non-strings', () => {
    expect(maskValue(12345)).toBe('****')
  })
})

describe('maskObject', () => {
  it('masks known secret keys', () => {
    const obj = { apiKey: 'sk-ant-abcdef1234567890xyz', name: 'test' }
    const result = maskObject(obj)
    expect(result.apiKey).toBe('sk-a****0xyz')
    expect(result.name).toBe('test')
  })

  it('handles nested objects', () => {
    const obj = { config: { token: 'secret-value-long-enough', port: 4096 } }
    const result = maskObject(obj)
    expect(result.config.token).toBe('secr****ough')
    expect(result.config.port).toBe(4096)
  })

  it('handles arrays', () => {
    const arr = [{ password: 'longpassword123' }, { safe: 'hello' }]
    const result = maskObject(arr)
    expect(result[0].password).toBe('long****d123')
    expect(result[1].safe).toBe('hello')
  })

  it('returns null/primitives unchanged', () => {
    expect(maskObject(null)).toBe(null)
    expect(maskObject(42)).toBe(42)
    expect(maskObject('str')).toBe('str')
  })

  it('masks all common secret field names', () => {
    const fields = {
      api_key: 'value-long-enough-here',
      authToken: 'value-long-enough-here',
      authorization: 'value-long-enough-here',
      clientSecret: 'value-long-enough-here',
      gateway_api_token: 'value-long-enough-here',
      twilio_auth_token: 'value-long-enough-here',
      companycam_api_token: 'value-long-enough-here',
      anthropic_api_key: 'value-long-enough-here',
      join_api_key: 'value-long-enough-here',
      location_secret: 'value-long-enough-here',
    }
    const result = maskObject(fields)
    for (const key of Object.keys(fields)) {
      expect(result[key]).not.toBe('value-long-enough-here')
      expect(result[key]).toContain('****')
    }
  })

  it('does not mask non-secret keys', () => {
    const obj = { port: 4096, host: 'localhost', model: 'claude-sonnet' }
    const result = maskObject(obj)
    expect(result).toEqual(obj)
  })
})

describe('isSecretKey', () => {
  it('recognizes known secret keys', () => {
    expect(isSecretKey('apiKey')).toBe(true)
    expect(isSecretKey('ANTHROPIC_API_KEY')).toBe(true)
    expect(isSecretKey('gateway_api_token')).toBe(true)
  })

  it('rejects non-secret keys', () => {
    expect(isSecretKey('port')).toBe(false)
    expect(isSecretKey('model')).toBe(false)
    expect(isSecretKey('host')).toBe(false)
  })
})

describe('scrubSecrets', () => {
  it('masks Anthropic API keys in strings', () => {
    const msg = 'Error: auth failed with sk-ant-api03-abcdefghij1234567890'
    const result = scrubSecrets(msg)
    expect(result).toContain('****')
    expect(result).not.toContain('abcdefghij')
    expect(result).toContain('Error: auth failed with')
  })

  it('masks Twilio account SIDs', () => {
    const msg = 'Twilio error for AC1234567890abcdef1234567890abcdef'
    const result = scrubSecrets(msg)
    expect(result).toContain('****')
    expect(result).not.toContain('AC1234567890abcdef1234567890abcdef')
  })

  it('masks Twilio API key SIDs', () => {
    const msg = 'Key SK1234567890abcdef1234567890abcdef failed'
    const result = scrubSecrets(msg)
    expect(result).toContain('****')
    expect(result).not.toContain('SK1234567890abcdef1234567890abcdef')
  })

  it('masks Bearer tokens', () => {
    const msg = 'Header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig'
    const result = scrubSecrets(msg)
    expect(result).toContain('****')
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
  })

  it('masks apikey query params', () => {
    const msg = 'GET https://api.example.com?apikey=supersecretvalue123&other=ok'
    const result = scrubSecrets(msg)
    expect(result).toContain('****')
    expect(result).not.toContain('supersecretvalue123')
  })

  it('returns empty string for null/undefined', () => {
    expect(scrubSecrets(null)).toBe('')
    expect(scrubSecrets(undefined)).toBe('')
  })

  it('leaves clean strings unchanged', () => {
    const msg = 'Normal error: connection refused on port 4096'
    expect(scrubSecrets(msg)).toBe(msg)
  })
})
