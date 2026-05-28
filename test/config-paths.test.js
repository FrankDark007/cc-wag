import path from 'path'
import { describe, it, expect } from 'vitest'
import { resolveModel } from '../src/config.js'

// resolveModel is a pure function over an explicit env object, so these tests
// are independent of any real .env that dotenv may have loaded.
describe('config model selection', () => {
  it('defaults to null (SDK latest) when no override set', () => {
    expect(resolveModel({})).toBe(null)
  })

  it('does not pin a specific version by default', () => {
    expect(resolveModel({})).toBeNull()
  })

  it('ATLAS_MODEL overrides default', () => {
    expect(resolveModel({ ATLAS_MODEL: 'claude-opus-4-8' })).toBe('claude-opus-4-8')
  })

  it('CLAUDE_MODEL is used as fallback when ATLAS_MODEL unset', () => {
    expect(resolveModel({ CLAUDE_MODEL: 'claude-haiku-4-5-20251001' })).toBe('claude-haiku-4-5-20251001')
  })

  it('ATLAS_MODEL takes precedence over CLAUDE_MODEL', () => {
    expect(resolveModel({ ATLAS_MODEL: 'claude-opus-4-8', CLAUDE_MODEL: 'claude-sonnet-4-6' })).toBe('claude-opus-4-8')
  })

  it('never silently defaults to Sonnet', () => {
    expect(resolveModel({}) ?? '').not.toContain('sonnet')
  })
})

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
