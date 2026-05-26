#!/usr/bin/env node
/**
 * Import 59 client folders from Google Drive into jobs.json
 * Run once: node scripts/import-drive-jobs.js
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const PROJECT_ROOT = process.env.ATLAS_PROJECT_ROOT || path.resolve(path.dirname(__filename), '..')
const JOBS_FILE = path.join(PROJECT_ROOT, 'workspace', 'jobs.json')
const DRIVE_DATA = path.join(PROJECT_ROOT, 'workspace', 'drive-invoicing-folders.json')
const PARENT_FOLDER_ID = '1QYQysnw8kYfwY14fgPgfAx5nlqlmfSxW'

// Load Drive folder listing
const driveRaw = JSON.parse(fs.readFileSync(DRIVE_DATA, 'utf-8'))
const folders = driveRaw.files || []

// Load existing jobs (if any)
let jobData = { nextId: 1, jobs: [] }
if (fs.existsSync(JOBS_FILE)) {
  jobData = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
  console.log(`Existing jobs.json found with ${jobData.jobs.length} jobs`)
}

// Track existing clients to avoid duplicates
const existingClients = new Set(jobData.jobs.map(j => j.client?.toLowerCase()))

let imported = 0
let skipped = 0

for (const folder of folders) {
  // Parse folder name: "01 - Janet Phillips" -> client name
  const match = folder.name.match(/^\d+\s*-\s*(.+)$/)
  if (!match) {
    console.log(`Skipping unparseable folder: ${folder.name}`)
    skipped++
    continue
  }

  const clientName = match[1].trim()

  // Skip if already exists
  if (existingClients.has(clientName.toLowerCase())) {
    console.log(`Skipping duplicate: ${clientName}`)
    skipped++
    continue
  }

  const id = `FD-${String(jobData.nextId).padStart(3, '0')}`
  const now = new Date().toISOString()

  // Use folder creation date as a proxy for job start date
  const createdDate = folder.createdTime || now

  // 90-day lien deadline from folder creation
  const lienDate = new Date(createdDate)
  lienDate.setDate(lienDate.getDate() + 90)

  const job = {
    id,
    client: clientName,
    address: '',
    city: '',
    status: 'needs-invoice',
    dateCreated: createdDate,
    dateCompleted: createdDate, // Assume completed since they need invoicing
    invoiceAmount: null,
    invoiceDate: null,
    paymentDate: null,
    adjuster: null,
    adjusterEmail: null,
    lienDeadline: lienDate.toISOString(),
    driveFolderId: folder.id,
    driveUrl: `https://drive.google.com/drive/folders/${folder.id}`,
    notes: [`Imported from Drive invoicing folder: ${folder.name}`]
  }

  jobData.jobs.push(job)
  jobData.nextId++
  existingClients.add(clientName.toLowerCase())
  imported++

  console.log(`${id}: ${clientName} (lien deadline: ${lienDate.toLocaleDateString()})`)
}

// Save
fs.writeFileSync(JOBS_FILE, JSON.stringify(jobData, null, 2))

console.log(`\nDone: ${imported} imported, ${skipped} skipped`)
console.log(`Total jobs in tracker: ${jobData.jobs.length}`)
console.log(`Jobs file: ${JOBS_FILE}`)
