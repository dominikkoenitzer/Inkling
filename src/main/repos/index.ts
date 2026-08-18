/**
 * The data layer, one module per domain.
 *
 * Everything is re-exported here because both callers use `import * as repos`,
 * so `repos.createNote(…)` reads the same as it always did — the split is in how
 * the code is organised, not in how it is called.
 *
 * The dependency direction is one-way and there are no cycles: `search` and
 * `dates` sit at the bottom, `notes` builds on them, and `links`, `tasks`,
 * `stats` and `onboarding` build on those.
 */

export * from './flashcards'
export * from './focus'
export * from './grades'
export * from './links'
export * from './notebooks'
export * from './notes'
export * from './onboarding'
export { searchQuery, tiptapToText } from './search'
export * from './settings'
export * from './stats'
export { bumpStreak, getStreak } from './streak'
export * from './tags'
export * from './tasks'
