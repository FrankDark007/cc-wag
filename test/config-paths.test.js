import path from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('config model selection', () => {
  let origAtlas, origClaude

  beforeEach(() => {
    origAtlas = process.env.ATLAS_MODEL
    origClaude = process.env.CLAUDE_MODEL
  })

  afterEach(() => {
    if (origAtlas === undefined) delete process.env.ATLAS_MODEL
    else process.env.ATLAS_MODEL = origAtlas
    if (origClaude === undefined) delete process.env.CLAUDE_MODEL
    else process.env.CLAUDE_MODEL = origClaude
  })

  it('defaults to null (SDK latest) when no override set', async () => {
    delete process.env.ATLAS_MODEL
    delete process.env.CLAUDE_MODEL
    const config = (await import('../src/config.js?model-default')).default
    expect(config.model).toBe(null)
  })

  it('does not pin a specific version by default', async () => {
    delete process.env.ATLAS_MODEL
    delete process.env.CLAUDE_MODEL
    const config = (await import('../src/config.js?model-noversion')).default
    expect(config.model).toBeNull()
  })

  it('ATLAS_MODEL overrides default', async () => {
    process.env.ATLAS_MODEL = 'claude-sonnet-4-6'
    delete process.env.CLAUDE_MODEL
    const config = (await import('../src/config.js?model-atlas')).default
    expect(config.model).toBe('claude-sonnet-4-6')
  })

  it('CLAUDE_MODEL is used as fallback when ATLAS_MODEL unset', async () => {
    delete process.env.ATLAS_MODEL
    process.env.CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
    const config = (await import('../src/config.js?model-claude')).default
    expect(config.model).toBe('claude-haiku-4-5-20251001')
  })

  it('ATLAS_MODEL takes precedence over CLAUDE_MODEL', async () => {
    process.env.ATLAS_MODEL = 'claude-opus-4-7'
    process.env.CLAUDE_MODEL = 'claude-sonnet-4-6'
    const config = (await import('../src/config.js?model-priority')).default
    expect(config.model).toBe('claude-opus-4-7')
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
