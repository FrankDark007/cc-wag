// docusign.js — DocuSign e-signature plugin for Atlas
//
// Work authorizations + certificates of satisfaction, signed via DocuSign.
//
// Slash command:
//   /sign status   — list the most recent envelopes and their status
//
// Agent API:
//   import { sendEnvelope } from './plugins/docusign.js'
//   await sendEnvelope({
//     signerEmail, signerName,
//     documentBase64,            // base64 of a PDF
//     documentName,              // e.g. 'Work-Authorization.pdf'
//     subject,                   // email subject for the signing request
//   })
//   -> { envelopeId, status }
//
// Config (process.env):
//   DS_INTEGRATION_KEY  — required (OAuth client / "iss")
//   DS_USER_ID          — required (API username GUID to impersonate / "sub")
//   DS_ACCOUNT_ID       — required (API account id)
//   DS_PRIVATE_KEY      — required (RSA private key PEM; literal newlines OR \n-escaped)
//   DS_BASE_PATH        — optional, default https://na3.docusign.net
//   DS_OAUTH_HOST       — optional, default account.docusign.com (use account-d.docusign.com for demo)
//
// Plugin is inert unless the four required vars are set.
//
// JWT grant:  POST https://{oauthHost}/oauth/token
//   grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<signed JWT>
//   JWT (RS256): { iss: integrationKey, sub: userId, aud: oauthHost,
//                  iat, exp (<=1h), scope: "signature impersonation" }
//   -> { access_token, expires_in, token_type }

import { createSign } from 'node:crypto'

function oauthHost() {
  return process.env.DS_OAUTH_HOST || 'account.docusign.com'
}
function basePath() {
  return (process.env.DS_BASE_PATH || 'https://na3.docusign.net').replace(/\/+$/, '')
}
function privateKey() {
  // Support keys stored with escaped newlines in .env.
  return (process.env.DS_PRIVATE_KEY || '').replace(/\\n/g, '\n')
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Build and sign a JWT (RS256) assertion for the DocuSign JWT grant.
function buildAssertion() {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: process.env.DS_INTEGRATION_KEY,
    sub: process.env.DS_USER_ID,
    aud: oauthHost(),
    iat: now,
    exp: now + 3600,
    scope: 'signature impersonation',
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  const signature = signer.sign(privateKey()).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${signingInput}.${signature}`
}

let _token = null
let _tokenExp = 0

async function getAccessToken() {
  if (_token && Date.now() < _tokenExp) return _token

  const res = await fetch(`https://${oauthHost()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildAssertion(),
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // consent_required means the user must grant JWT consent once in a browser.
    throw new Error(`DocuSign auth ${res.status}: ${detail.slice(0, 250)}`)
  }

  const data = await res.json()
  _token = data.access_token
  _tokenExp = Date.now() + ((data.expires_in || 3600) - 120) * 1000
  return _token
}

// Exported: send a single-document, single-signer envelope for signature.
export async function sendEnvelope({ signerEmail, signerName, documentBase64, documentName, subject }) {
  if (!signerEmail || !signerName || !documentBase64) {
    throw new Error('sendEnvelope requires signerEmail, signerName, documentBase64')
  }
  const token = await getAccessToken()
  const account = process.env.DS_ACCOUNT_ID

  const envelope = {
    emailSubject: subject || 'Please sign: Flood Doctor document',
    status: 'sent',
    documents: [{
      documentBase64,
      name: documentName || 'Document.pdf',
      fileExtension: 'pdf',
      documentId: '1',
    }],
    recipients: {
      signers: [{
        email: signerEmail,
        name: signerName,
        recipientId: '1',
        routingOrder: '1',
        tabs: {
          signHereTabs: [{
            documentId: '1', pageNumber: '1', xPosition: '100', yPosition: '650',
          }],
        },
      }],
    },
  }

  const res = await fetch(`${basePath()}/restapi/v2.1/accounts/${account}/envelopes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(envelope),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`DocuSign send ${res.status}: ${detail.slice(0, 250)}`)
  }
  const data = await res.json()
  return { envelopeId: data.envelopeId, status: data.status }
}

async function listEnvelopes() {
  const token = await getAccessToken()
  const account = process.env.DS_ACCOUNT_ID
  // from_date required; look back 30 days.
  const from = new Date(Date.now() - 30 * 86400000).toISOString()
  const url = `${basePath()}/restapi/v2.1/accounts/${account}/envelopes?from_date=${encodeURIComponent(from)}&order=desc&count=10`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`DocuSign list ${res.status}: ${detail.slice(0, 250)}`)
  }
  const data = await res.json()
  const envs = data.envelopes || []
  if (!envs.length) return '*Envelopes*\nNo envelopes in the last 30 days.'
  const lines = envs.slice(0, 10).map((e) => {
    const subj = (e.emailSubject || '(no subject)').slice(0, 50)
    return `• ${e.status} — ${subj}`
  })
  return `*Recent envelopes*\n${lines.join('\n')}`
}

export function register(gateway) {
  const required = ['DS_INTEGRATION_KEY', 'DS_USER_ID', 'DS_ACCOUNT_ID', 'DS_PRIVATE_KEY']
  const missing = required.filter((k) => !process.env[k])
  if (missing.length) {
    console.log(`[docusign] disabled — set ${missing.join(', ')} to enable`)
    return
  }

  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)
  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const trimmed = (text || '').trim().toLowerCase()
    if (trimmed === '/sign' || trimmed.startsWith('/sign ')) {
      const sub = trimmed.slice(5).trim()
      try {
        let result
        if (sub === 'status') result = await listEnvelopes()
        else result = 'Usage: `/sign status`'
        return { handled: true, response: `🔱 *Atlas*\n\n${result}` }
      } catch (err) {
        return { handled: true, response: `🔱 *Atlas*\n\nDocuSign failed: ${err.message}` }
      }
    }
    return originalExecute(text, sessionKey, adapter, chatId)
  }

  console.log('[docusign] enabled — /sign status')
}
