// quickbooks.js — QuickBooks Online (Intuit) plugin for Atlas
//
// Authoritative revenue / invoice totals straight from the books.
//
// Slash commands:
//   /qb revenue   — total income (paid invoices) this calendar year
//   /qb invoices  — count + open balance of the most recent invoices
//
// Config (process.env):
//   QBO_CLIENT_ID      — required
//   QBO_CLIENT_SECRET  — required
//   QBO_REFRESH_TOKEN  — required (long-lived refresh token, ~100 days)
//   QBO_REALM_ID       — required (company / realm id)
//   QBO_ENV            — optional: "production" (default) | "sandbox"
//
// Plugin is fully inert unless ALL four required vars are set.
//
// Intuit OAuth2 refresh:  POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
//   Authorization: Basic base64(clientId:clientSecret)
//   Content-Type: application/x-www-form-urlencoded
//   body: grant_type=refresh_token&refresh_token=<token>
//   -> { access_token, refresh_token, expires_in }
//
// Accounting query:  GET https://quickbooks.api.intuit.com/v3/company/{realmId}/query?query=<SQL>
//   (sandbox base: https://sandbox-quickbooks.api.intuit.com)
//   Authorization: Bearer <access_token>; Accept: application/json

const TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

function apiBase() {
  return process.env.QBO_ENV === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com'
}

// Cache the access token in-memory for its lifetime (minus a safety margin).
let _token = null
let _tokenExp = 0

async function getAccessToken() {
  if (_token && Date.now() < _tokenExp) return _token

  const id = process.env.QBO_CLIENT_ID
  const secret = process.env.QBO_CLIENT_SECRET
  const refresh = process.env.QBO_REFRESH_TOKEN
  const basic = Buffer.from(`${id}:${secret}`).toString('base64')

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`token refresh ${res.status}: ${detail.slice(0, 200)}`)
  }

  const data = await res.json()
  _token = data.access_token
  _tokenExp = Date.now() + ((data.expires_in || 3600) - 120) * 1000
  // Note: data.refresh_token rotates ~periodically; surface it so the operator
  // can persist it back to QBO_REFRESH_TOKEN if Intuit rotated it.
  if (data.refresh_token && data.refresh_token !== refresh) {
    console.log('[quickbooks] refresh token rotated — update QBO_REFRESH_TOKEN to:', data.refresh_token)
  }
  return _token
}

// Run a QBO SQL-ish query and return the parsed QueryResponse.
async function qboQuery(query) {
  const token = await getAccessToken()
  const realm = process.env.QBO_REALM_ID
  const url = `${apiBase()}/v3/company/${realm}/query?query=${encodeURIComponent(query)}&minorversion=70`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`QBO query ${res.status}: ${detail.slice(0, 200)}`)
  }

  const data = await res.json()
  return data.QueryResponse || {}
}

const fmt = (n) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function getRevenue() {
  const year = new Date().getFullYear()
  // Payments received this calendar year = recognized cash revenue.
  const q = `SELECT * FROM Payment WHERE TxnDate >= '${year}-01-01' MAXRESULTS 1000`
  const r = await qboQuery(q)
  const payments = r.Payment || []
  const total = payments.reduce((s, p) => s + Number(p.TotalAmt || 0), 0)
  return `*Revenue ${year}*\nPayments received: ${payments.length}\nTotal collected: *${fmt(total)}*`
}

async function getInvoices() {
  const q = 'SELECT * FROM Invoice ORDER BY MetaData.LastUpdatedTime DESC MAXRESULTS 10'
  const r = await qboQuery(q)
  const invoices = r.Invoice || []
  if (!invoices.length) return '*Invoices*\nNo invoices found.'
  const openBal = invoices.reduce((s, i) => s + Number(i.Balance || 0), 0)
  const lines = invoices.slice(0, 10).map((i) => {
    const name = i.CustomerRef?.name || i.CustomerRef?.value || '?'
    const bal = Number(i.Balance || 0)
    const status = bal > 0 ? `open ${fmt(bal)}` : 'paid'
    return `• #${i.DocNumber || i.Id} — ${name} — ${fmt(i.TotalAmt)} (${status})`
  })
  return `*Recent invoices* (open balance ${fmt(openBal)})\n${lines.join('\n')}`
}

export function register(gateway) {
  const required = ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_REFRESH_TOKEN', 'QBO_REALM_ID']
  const missing = required.filter((k) => !process.env[k])
  if (missing.length) {
    console.log(`[quickbooks] disabled — set ${missing.join(', ')} to enable`)
    return
  }

  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)
  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const trimmed = (text || '').trim().toLowerCase()
    if (trimmed === '/qb' || trimmed.startsWith('/qb ')) {
      const sub = trimmed.slice(3).trim()
      try {
        let result
        if (sub === 'revenue') result = await getRevenue()
        else if (sub === 'invoices') result = await getInvoices()
        else result = 'Usage: `/qb revenue` or `/qb invoices`'
        return { handled: true, response: `🔱 *Atlas*\n\n${result}` }
      } catch (err) {
        return { handled: true, response: `🔱 *Atlas*\n\nQuickBooks failed: ${err.message}` }
      }
    }
    return originalExecute(text, sessionKey, adapter, chatId)
  }

  console.log('[quickbooks] enabled — /qb revenue, /qb invoices')
}
