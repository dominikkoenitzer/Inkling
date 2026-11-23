import * as repos from './repos'

/** Runs one start step; a failed one is logged, since no step may keep Inkling from starting. */
function step(name: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    console.error(`${name} failed`, err)
  }
}

/**
 * What each start does once the database is open and migrated: the expired trash goes, notes
 * left empty go, to-dos from before checkboxes lived in notes get a note, rows for empty lines
 * go, and a first run gets its welcome note. `seed` fills a demo profile in between.
 */
export function settleData(seed?: () => void): void {
  step('trash purge', repos.purgeExpiredNotes)
  step('dropping empty notes', repos.dropEmptyNotes)
  seed?.()
  step('adopting loose tasks', repos.adoptLooseTasks)
  step('dropping blank tasks', repos.dropBlankTasks)
  step('first run setup', repos.bootstrapFirstRun)
}
