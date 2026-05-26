import crypto from 'crypto'
import { describe, it, expect } from 'vitest'
import TwilioWhatsAppAdapter from '../src/adapters/twilio-whatsapp.js'

function computeSignature(authToken, url, params) {
  const keys = Object.keys(params).sort()
  let data = url
  for (const key of keys) {
    data += key + params[key]
  }
  return crypto.createHmac('sha1', authToken).update(data).digest('base64')
}

const TEST_TOKEN = 'test-auth-token-for-testing-only'
const TEST_URL = 'https://atlas.vaserv.pro/webhook/twilio'

function makeAdapter(overrides = {}) {
  return new TwilioWhatsAppAdapter({
    accountSid: 'ACtest',
    authToken: TEST_TOKEN,
    whatsappNumber: '+15715821100',
    webhookUrl: TEST_URL,
    allowedDMs: [],
    allowedGroups: [],
    ...overrides,
  })
}

describe('TwilioWhatsAppAdapter.validateSignature', () => {
  it('accepts a valid signature', () => {
    const adapter = makeAdapter()
    const params = { Body: 'Hello', From: 'whatsapp:+17034981581', MessageSid: 'SM123' }
    const sig = computeSignature(TEST_TOKEN, TEST_URL, params)
    expect(adapter.validateSignature(sig, TEST_URL, params)).toBe(true)
  })

  it('rejects an invalid signature', () => {
    const adapter = makeAdapter()
    const params = { Body: 'Hello', From: 'whatsapp:+17034981581' }
    expect(adapter.validateSignature('badsignature', TEST_URL, params)).toBe(false)
  })

  it('rejects a missing signature when validation is enabled', () => {
    const adapter = makeAdapter()
    const params = { Body: 'Hello', From: 'whatsapp:+17034981581' }
    expect(adapter.validateSignature('', TEST_URL, params)).toBe(false)
  })

  it('skips validation when webhookUrl is not set', () => {
    const adapter = makeAdapter({ webhookUrl: '' })
    expect(adapter.validateSignature('anything', TEST_URL, {})).toBe(true)
  })

  it('skips validation when webhookUrl is undefined', () => {
    const adapter = makeAdapter({ webhookUrl: undefined })
    expect(adapter.validateSignature('anything', TEST_URL, {})).toBe(true)
  })

  it('handles params with special characters', () => {
    const adapter = makeAdapter()
    const params = { Body: 'Hello & goodbye', From: 'whatsapp:+17034981581' }
    const sig = computeSignature(TEST_TOKEN, TEST_URL, params)
    expect(adapter.validateSignature(sig, TEST_URL, params)).toBe(true)
  })

  it('sorts params alphabetically per Twilio spec', () => {
    const adapter = makeAdapter()
    const params = { Zebra: '1', Alpha: '2', Middle: '3' }
    const sig = computeSignature(TEST_TOKEN, TEST_URL, params)
    expect(adapter.validateSignature(sig, TEST_URL, params)).toBe(true)
  })

  it('rejects when body is tampered', () => {
    const adapter = makeAdapter()
    const original = { Body: 'Hello', From: 'whatsapp:+17034981581' }
    const sig = computeSignature(TEST_TOKEN, TEST_URL, original)
    const tampered = { Body: 'Injected message', From: 'whatsapp:+17034981581' }
    expect(adapter.validateSignature(sig, TEST_URL, tampered)).toBe(false)
  })
})
