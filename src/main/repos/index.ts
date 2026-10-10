/**
 * The data layer, one module per domain, re-exported so callers can `import * as repos`.
 * Dependencies run one way: `search` and `dates` at the bottom, then `notes`, then
 * `tasks`, `stats` and `onboarding`.
 */

export * from './flashcards'
export * from './focus'
export * from './grades'
export * from './notebooks'
export * from './notes'
export * from './onboarding'
export { searchQuery, tiptapToText } from './search'
export * from './settings'
export * from './stats'
export { bumpStreak, getStreak } from './streak'
export * from './tasks'
