/** Small shared parsing helpers: note card lines, note task extraction, fuzzy match. */

export { parseCardLine, paragraphText, extractNoteCardLines, type NoteCardLineAt } from '@shared/noteCards'

/* ---- Task items inside a note's TipTap JSON (checkbox → real task, §7) ---- */
export { extractNoteTaskItems } from '@shared/noteTasks'

/** A title field holds one line: Enter is handled by the caller and pasted breaks become spaces. */
export const oneLine = (value: string): string => value.replace(/\r?\n/g, ' ')

/** A stored note's doc, or an empty one when the content cannot be read. */
export function safeParse(content: string): object {
  try {
    const doc: unknown = JSON.parse(content)
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) return doc
  } catch {
    // not JSON
  }
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}
