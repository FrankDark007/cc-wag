// ocr.js — Mistral OCR plugin for Atlas
//
// Turns photographed scope sheets, denial letters, and EOBs into text.
//
// Slash command:  /ocr <image-url-or-path>
// Agent API:      import { ocrImage } from './plugins/ocr.js'
//                 const text = await ocrImage('https://.../scope.jpg')
//                 (the agent can call ocrImage(urlOrPath) directly — it accepts
//                  a public http(s) URL, a data: URL, or a local file path)
//
// Config (process.env):
//   MISTRAL_API_KEY  — required. Plugin is inert without it.
//
// Mistral OCR API: POST https://api.mistral.ai/v1/ocr
//   { model: "mistral-ocr-latest",
//     document: { type: "image_url", image_url: "<url|data-uri>" } | { type: "document_url", document_url: "<url>" } }
//   -> { pages: [ { index, markdown, ... } ], ... }

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

const OCR_ENDPOINT = 'https://api.mistral.ai/v1/ocr'
const MODEL = 'mistral-ocr-latest'

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
}

// Build the Mistral `document` object from a URL or a local path.
async function buildDocument(urlOrPath) {
  const v = (urlOrPath || '').trim()
  if (!v) throw new Error('no image url or path provided')

  // PDFs go through document_url; everything else through image_url.
  const isPdf = /\.pdf(\?|#|$)/i.test(v)

  if (/^https?:\/\//i.test(v)) {
    return isPdf
      ? { type: 'document_url', document_url: v }
      : { type: 'image_url', image_url: v }
  }
  if (/^data:/i.test(v)) {
    return isPdf
      ? { type: 'document_url', document_url: v }
      : { type: 'image_url', image_url: v }
  }

  // Local file -> base64 data URI.
  const buf = await readFile(v)
  const mime = MIME[extname(v).toLowerCase()] || 'application/octet-stream'
  const dataUri = `data:${mime};base64,${buf.toString('base64')}`
  return mime === 'application/pdf'
    ? { type: 'document_url', document_url: dataUri }
    : { type: 'image_url', image_url: dataUri }
}

// Exported so the Atlas agent can OCR images programmatically.
export async function ocrImage(urlOrPath) {
  const key = process.env.MISTRAL_API_KEY
  if (!key) throw new Error('MISTRAL_API_KEY not set')

  const document = await buildDocument(urlOrPath)

  const res = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ model: MODEL, document }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Mistral OCR ${res.status}: ${detail.slice(0, 300)}`)
  }

  const data = await res.json()
  const text = (data.pages || [])
    .map((p) => p.markdown || '')
    .join('\n\n---\n\n')
    .trim()
  return text || '(no text extracted)'
}

export function register(gateway) {
  if (!process.env.MISTRAL_API_KEY) {
    console.log('[ocr] disabled — set MISTRAL_API_KEY to enable')
    return
  }

  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)
  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const trimmed = (text || '').trim()
    const lower = trimmed.toLowerCase()
    if (lower === '/ocr' || lower.startsWith('/ocr ')) {
      const arg = trimmed.slice(4).trim()
      if (!arg) {
        return { handled: true, response: '🔱 *Atlas*\n\nUsage: `/ocr <image-url-or-path>`' }
      }
      try {
        const result = await ocrImage(arg)
        return { handled: true, response: `🔱 *Atlas*\n\n${result.slice(0, 3500)}` }
      } catch (err) {
        return { handled: true, response: `🔱 *Atlas*\n\nOCR failed: ${err.message}` }
      }
    }
    return originalExecute(text, sessionKey, adapter, chatId)
  }

  console.log('[ocr] enabled — /ocr <image-url-or-path>')
}
