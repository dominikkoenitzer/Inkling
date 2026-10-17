/** Small shared parsing helpers: note card lines, note task extraction, fuzzy match. */

export { parseCardLine, paragraphText, extractNoteCardLines, type NoteCardLineAt } from '@shared/noteCards'

/* ---- Task items inside a note's TipTap JSON (checkbox → real task, §7) ---- */
export { extractNoteTaskItems } from '@shared/noteTasks'

/** A title field holds one line: Enter is handled by the caller and pasted breaks become spaces. */
export const oneLine = (value: string): string => value.replace(/\r?\n/g, ' ')
