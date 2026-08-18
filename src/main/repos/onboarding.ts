import { createNote } from './notes'
import { createNotebook } from './notebooks'
import { setSetting } from './settings'
import type { OnboardingPayload } from '@shared/types'

function welcomeDoc(): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Welcome to Inkling 👋' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'This is your first page. Type anywhere — everything saves automatically. Try ' },
          { type: 'text', marks: [{ type: 'bold' }], text: '**bold**' },
          { type: 'text', text: ', ' },
          { type: 'text', marks: [{ type: 'italic' }], text: '*italic*' },
          { type: 'text', text: ', or start a line with # for a heading.' }
        ]
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Checkboxes become real tasks' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Type [] at the start of a line — the item also shows up in your Tasks tab, fully linked both ways.' }]
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false, taskId: null },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Check me off — watch the Tasks tab' }] }]
          }
        ]
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Lines like these become flashcards' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Photosynthesis :: The process plants use to convert light into energy' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Mitochondria :: The powerhouse of the cell' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Open the ✨ menu in the editor toolbar and pick “Make flashcards from this note”.' }]
      }
    ]
  })
}

export function completeOnboarding(payload: OnboardingPayload): void {
  const first = createNotebook({ name: payload.notebookName || 'My Notebook', color: 'teal', kind: payload.purpose === 'school' ? 'school_subject' : 'general' })
  createNote({ notebook_id: first.id, type: 'page', title: 'Welcome to Inkling', content: welcomeDoc() })
  if (payload.purpose === 'school') {
    createNotebook({ name: 'Assignments', color: 'coral', icon: 'pen-tool', kind: 'school_subject' })
    createNotebook({ name: 'Class Notes', color: 'amber', icon: 'book-open', kind: 'school_subject' })
    createNotebook({ name: 'Study Decks', color: 'pink', icon: 'brain', kind: 'school_subject' })
  } else if (payload.purpose === 'work') {
    createNotebook({ name: 'Projects', color: 'coral', icon: 'briefcase' })
    createNotebook({ name: 'Meetings', color: 'amber', icon: 'coffee' })
  }
  if (payload.journal) {
    createNotebook({ name: 'Journal', color: 'gray', is_journal: true })
  }
  setSetting('onboarding_done', '1')
  setSetting('purpose', payload.purpose)
}
