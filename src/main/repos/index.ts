/**
 * The data layer, one module per domain, re-exported so callers can `import * as repos`.
 * Dependencies run one way: `search` and `dates` at the bottom, then `notes`, then
 * `tasks` and `onboarding`.
 */

export * from './flashcards'
export * from './notebooks'
export * from './notes'
export * from './onboarding'
export { searchQuery, tiptapToText } from './search'
export * from './settings'
export * from './tasks'
