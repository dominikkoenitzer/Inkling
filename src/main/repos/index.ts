/**
 * The data layer, one module per domain, re-exported so callers can `import * as repos`.
 * Dependencies run one way: `search` and `dates` at the bottom, then `notes`, then
 * `tasks` and `onboarding`.
 */

export * from './flashcards'
export * from './focus'
export { importAnkiFile } from './imports'
export * from './notebooks'
export * from './notes'
export * from './onboarding'
export { optimiseParams } from './scheduler'
export { searchQuery, tiptapToText } from './search'
export * from './settings'
export { bumpStreak, getStreak } from './streak'
export * from './tasks'
