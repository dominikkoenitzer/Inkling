import { createNote } from './notes'
import { createNotebook, listNotebooks } from './notebooks'

function welcomeDoc(): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Welcome to Inkling' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'This is your first page. Type anywhere. Everything saves automatically. Wrap a word in asterisks for ' },
          { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
          { type: 'text', text: ' or ' },
          { type: 'text', marks: [{ type: 'italic' }], text: 'italic' },
          { type: 'text', text: ', or start a line with # for a heading.' }
        ]
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Checkboxes become real tasks' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Type [] at the start of a line. The item also shows up in your Tasks tab, fully linked both ways.' }]
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false, taskId: null },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Check me off, then watch the Tasks tab' }] }]
          }
        ]
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Lines like these become flashcards' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Photosynthesis :: The process plants use to convert light into energy' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Mitochondria :: The powerhouse of the cell' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hit the Flashcards button in the editor toolbar to turn them into a deck.' }]
      }
    ]
  })
}

/**
 * First run: one notebook and one page explaining the app, created on the spot.
 *
 * This replaced a three-step wizard that asked for a notebook name, a "purpose" that only
 * changed which empty notebooks got made, and whether you wanted a journal. Renaming a
 * notebook takes one click, so asking first was ceremony.
 */
export function bootstrapFirstRun(name = 'My Notebook'): void {
  if (listNotebooks().length > 0) return
  const first = createNotebook({ name, color: 'teal' })
  createNote({ notebook_id: first.id, title: 'Welcome to Inkling', content: welcomeDoc() })
}
