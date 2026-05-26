import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import TwilioWhatsAppAdapter from '../src/adapters/twilio-whatsapp.js'

function makeAdapter() {
  return new TwilioWhatsAppAdapter({
    accountSid: 'ACtest123',
    authToken: 'test-token',
    whatsappNumber: '+15715821100',
    webhookUrl: '',
    allowedDMs: [],
    allowedGroups: [],
  })
}

describe('TwilioWhatsAppAdapter.sendMessage template support', () => {
  let adapter
  let fetchMock

  beforeEach(() => {
    adapter = makeAdapter()
    fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ sid: 'SM123', status: 'queued' })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends Body when no options provided', async () => {
    await adapter.sendMessage('17034981581@s.whatsapp.net', 'Hello Frank')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, opts] = fetchMock.mock.calls[0]
    const params = new URLSearchParams(opts.body)
    expect(params.get('Body')).toBe('Hello Frank')
    expect(params.get('From')).toBe('whatsapp:+15715821100')
    expect(params.get('To')).toBe('whatsapp:+17034981581')
    expect(params.has('ContentSid')).toBe(false)
  })

  it('sends Body when options is empty object', async () => {
    await adapter.sendMessage('17034981581@s.whatsapp.net', 'Hello', {})

    const params = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(params.get('Body')).toBe('Hello')
    expect(params.has('ContentSid')).toBe(false)
  })

  it('sends ContentSid when contentSid is provided', async () => {
    await adapter.sendMessage('17034981581@s.whatsapp.net', '', {
      contentSid: 'HX1234567890abcdef',
      contentVariables: { '1': 'Good morning' }
    })

    const params = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(params.get('ContentSid')).toBe('HX1234567890abcdef')
    expect(params.get('ContentVariables')).toBe('{"1":"Good morning"}')
    expect(params.has('Body')).toBe(false)
  })

  it('sends empty ContentVariables when none provided with contentSid', async () => {
    await adapter.sendMessage('17034981581@s.whatsapp.net', '', {
      contentSid: 'HXabc'
    })

    const params = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(params.get('ContentSid')).toBe('HXabc')
    expect(params.get('ContentVariables')).toBe('{}')
    expect(params.has('Body')).toBe(false)
  })

  it('resolves template name to Content SID from env', async () => {
    process.env.TWILIO_TPL_ATLAS_STATUS_UPDATE = 'HXstatus123'
    try {
      await adapter.sendMessage('17034981581@s.whatsapp.net', '', {
        template: 'atlas_status_update',
        contentVariables: { '1': 'Your briefing is ready' }
      })

      const params = new URLSearchParams(fetchMock.mock.calls[0][1].body)
      expect(params.get('ContentSid')).toBe('HXstatus123')
      expect(params.get('ContentVariables')).toBe('{"1":"Your briefing is ready"}')
      expect(params.has('Body')).toBe(false)
    } finally {
      delete process.env.TWILIO_TPL_ATLAS_STATUS_UPDATE
    }
  })

  it('throws when template name has no configured SID', async () => {
    delete process.env.TWILIO_TPL_ATLAS_STATUS_UPDATE

    await expect(
      adapter.sendMessage('17034981581@s.whatsapp.net', 'text', {
        template: 'atlas_status_update'
      })
    ).rejects.toThrow('Template "atlas_status_update" has no Content SID configured')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('error message does not contain secrets', async () => {
    delete process.env.TWILIO_TPL_ATLAS_ACTION_REQUIRED

    try {
      await adapter.sendMessage('17034981581@s.whatsapp.net', '', {
        template: 'atlas_action_required'
      })
    } catch (err) {
      expect(err.message).not.toContain('test-token')
      expect(err.message).not.toContain('ACtest123')
      expect(err.message).toContain('TWILIO_TPL_ATLAS_ACTION_REQUIRED')
    }
  })

  it('contentSid takes precedence over template name', async () => {
    process.env.TWILIO_TPL_ATLAS_STATUS_UPDATE = 'HXfromenv'
    try {
      await adapter.sendMessage('17034981581@s.whatsapp.net', '', {
        contentSid: 'HXexplicit',
        template: 'atlas_status_update'
      })

      const params = new URLSearchParams(fetchMock.mock.calls[0][1].body)
      expect(params.get('ContentSid')).toBe('HXexplicit')
    } finally {
      delete process.env.TWILIO_TPL_ATLAS_STATUS_UPDATE
    }
  })

  it('throws Twilio API errors', async () => {
    fetchMock.mockResolvedValueOnce({
      json: () => Promise.resolve({ error_code: 21610, error_message: 'Unsubscribed' })
    })

    await expect(
      adapter.sendMessage('17034981581@s.whatsapp.net', 'Hello')
    ).rejects.toThrow('Twilio error 21610: Unsubscribed')
  })
})

describe('TwilioWhatsAppAdapter.resolveTemplateSid', () => {
  const adapter = makeAdapter()

  it('reads from env var with correct naming', () => {
    process.env.TWILIO_TPL_ATLAS_VERIFICATION_CODE = 'HXverify789'
    try {
      expect(adapter.resolveTemplateSid('atlas_verification_code')).toBe('HXverify789')
    } finally {
      delete process.env.TWILIO_TPL_ATLAS_VERIFICATION_CODE
    }
  })

  it('returns empty string when env var not set', () => {
    delete process.env.TWILIO_TPL_NONEXISTENT
    expect(adapter.resolveTemplateSid('nonexistent')).toBe('')
  })

  it('is case-insensitive on template name', () => {
    process.env.TWILIO_TPL_ATLAS_STATUS_UPDATE = 'HXcase'
    try {
      expect(adapter.resolveTemplateSid('Atlas_Status_Update')).toBe('HXcase')
    } finally {
      delete process.env.TWILIO_TPL_ATLAS_STATUS_UPDATE
    }
  })
})
