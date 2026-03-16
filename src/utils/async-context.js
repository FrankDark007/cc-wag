import { AsyncLocalStorage } from 'async_hooks'

/**
 * Async context for per-request state
 * Replaces global mutable variables with request-scoped context
 */
export const asyncContext = new AsyncLocalStorage()

/**
 * Get the current async context store, or null if not in a context
 */
export function getStore() {
  return asyncContext.getStore() || null
}
