import { getDb } from '../db'
import { createNote } from './notes'
import { createNotebook, listNotebooks } from './notebooks'
import { syncNoteTasks } from './tasks'

const text = (t: string): object => ({ type: 'text', text: t })
const p = (...parts: object[]): object => ({ type: 'paragraph', content: parts })
const h2 = (t: string): object => ({ type: 'heading', attrs: { level: 2 }, content: [text(t)] })

function welcomeDoc(taskId: number | null): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      p(text('This is a note. Type anywhere, it saves as you go.')),
      h2('To-dos'),
      p(text('Start a line with [ ] to make a to-do. Open ones show up on Today.')),
      {
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: false, taskId }, content: [p(text('Tick me off'))] }]
      },
      h2('Flashcards'),
      p(text('Write a term, two colons, then what it means:')),
      p(text('Photosynthesis :: How plants turn light into energy')),
      p(text('Mitochondria :: Makes the energy the cell runs on')),
      p(text('Then press Flashcards above the note. Study shows you each card when it is due.'))
    ]
  })
}

/** First run: one welcome note, made on the spot. */
export function bootstrapFirstRun(): void {
  getDb().transaction(() => {
    if (listNotebooks().length > 0) return
    const home = createNotebook({ name: 'Notes', color: 'teal' })
    const note = createNote({ notebook_id: home.id, title: 'Welcome to Inkling', content: welcomeDoc(null) })
    const [taskId] = syncNoteTasks(note.id, home.id, [{ taskId: null, title: 'Tick me off', checked: false }])
    getDb().prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(welcomeDoc(taskId), note.id)
  })()
}
