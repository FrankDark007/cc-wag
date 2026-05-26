import path from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('config PROJECT_ROOT', () => {
  let originalEnv

  beforeEach(() => {
    originalEnv = process.env.ATLAS_PROJECT_ROOT
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ATLAS_PROJECT_ROOT
    } else {
      process.env.ATLAS_PROJECT_ROOT = originalEnv
    }
  })

  it('defaults to repo root derived from import.meta.url', async () => {
    delete process.env.ATLAS_PROJECT_ROOT
    const configModule = await import('../src/config.js?default')
    const config = configModule.default
    const expectedRoot = path.resolve(import.meta.dirname, '..')
    expect(config.paths.root).toBe(expectedRoot)
  })

  it('respects ATLAS_PROJECT_ROOT override', async () => {
    process.env.ATLAS_PROJECT_ROOT = '/tmp/test-atlas-root'
    const configModule = await import('../src/config.js?override')
    const config = configModule.default
    expect(config.paths.root).toBe('/tmp/test-atlas-root')
  })

  it('workspace follows PROJECT_ROOT', async () => {
    process.env.ATLAS_PROJECT_ROOT = '/tmp/test-atlas-root'
    const configModule = await import('../src/config.js?workspace')
    const config = configModule.default
    expect(config.paths.workspace).toBe('/tmp/test-atlas-root/workspace')
  })

  it('all config.paths are under PROJECT_ROOT or HOME', async () => {
    process.env.ATLAS_PROJECT_ROOT = '/tmp/atlas-check'
    const configModule = await import('../src/config.js?allpaths')
    const config = configModule.default
    const homedir = (await import('os')).homedir()

    for (const [key, val] of Object.entries(config.paths)) {
      if (typeof val !== 'string') continue
      const underRoot = val.startsWith('/tmp/atlas-check')
      const underHome = val.startsWith(homedir)
      const isBinary = key === 'gwsBin'
      expect(underRoot || underHome || isBinary, `paths.${key} = ${val}`).toBe(true)
    }
  })
})
