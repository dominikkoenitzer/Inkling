import { getDb } from './db'
import * as repos from './repos'

// Demo data for screenshots and the smoke test. Unpackaged builds only, behind INKLING_SEED.

type Block = Record<string, unknown>

const text = (t: string): Block => ({ type: 'text', text: t })
const p = (t: string): Block => ({ type: 'paragraph', content: t ? [text(t)] : [] })
const h = (level: number, t: string): Block => ({ type: 'heading', attrs: { level }, content: [text(t)] })
const todo = (t: string, checked = false): Block => ({
  type: 'taskItem',
  attrs: { checked, taskId: null },
  content: [p(t)]
})

/** Saves a note and links its checkboxes to task rows, as the editor would. */
function note(notebookId: number, title: string, blocks: Block[]): number {
  const created = repos.createNote({ notebook_id: notebookId, title, content: JSON.stringify({ type: 'doc', content: blocks }) })
  const items: Block[] = []
  const collect = (b: Block): void => {
    if (b.type === 'taskItem') items.push(b)
    for (const c of (b.content as Block[] | undefined) ?? []) collect(c)
  }
  blocks.forEach(collect)
  if (items.length === 0) return created.id
  const ids = repos.syncNoteTasks(
    created.id,
    notebookId,
    items.map((i) => ({
      taskId: null,
      title: String(((i.content as Block[])[0].content as Block[])[0].text),
      checked: (i.attrs as { checked: boolean }).checked
    }))
  )
  items.forEach((i, n) => ((i.attrs as { taskId: number | null }).taskId = ids[n]))
  getDb().prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(JSON.stringify({ type: 'doc', content: blocks }), created.id)
  return created.id
}

export function seedDemo(): void {
  if (repos.listNotebooks().length > 0) return
  const nb = repos.homeNotebookId()

  note(nb, 'History: Cold War timeline', [
    p('Two camps, no direct war. Everything happened around the edges.'),
    h(2, 'Key years'),
    { type: 'bulletList', content: ['1947 Truman Doctrine', '1961 Berlin Wall goes up', '1962 Cuban Missile Crisis', '1989 the Wall comes down'].map((t) => ({ type: 'listItem', content: [p(t)] })) },
    { type: 'taskList', content: [todo('Summarise chapter 6'), todo('Pick an essay question', true)] }
  ])
  note(nb, 'Maths: Integration by parts', [
    p('∫ u dv = uv − ∫ v du. Pick u so that du is simpler than u.'),
    p('A good order for choosing u: logs, inverse trig, algebra, trig, exponentials.'),
    { type: 'taskList', content: [todo('Problem set 7'), todo('Redo exercise 4b')] }
  ])
  note(nb, 'Lab report', [
    p('Due Friday. Keep it to four pages.'),
    { type: 'taskList', content: [todo('Write the method section'), todo('Make the results table'), todo('Ask Lea for the raw data', true)] }
  ])
  const biology = note(nb, 'Biology: The cell', [
    p('Everything alive is made of cells. These are the parts that come up in the test.'),
    h(2, 'Terms'),
    p('Mitochondria :: Makes the energy the cell runs on'),
    p('Ribosome :: Builds proteins'),
    p('Osmosis :: Water moving across a membrane toward the saltier side'),
    { type: 'taskList', content: [todo('Read chapter 4'), todo('Make flashcards from the terms', true)] }
  ])

  const deck = repos.createDeck(nb, 'Biology: The cell')
  getDb().prepare(`UPDATE flashcard_decks SET note_id = ? WHERE id = ?`).run(biology, deck.id)
  repos.addCard(deck.id, 'Mitochondria', 'Makes the energy the cell runs on')
  repos.addCard(deck.id, 'Ribosome', 'Builds proteins')
  repos.addCard(deck.id, 'Osmosis', 'Water moving across a membrane toward the saltier side')
  const vocab = repos.createDeck(nb, 'French vocabulary')
  repos.addCard(vocab.id, 'la bibliothèque', 'the library')
  repos.addCard(vocab.id, 'le cahier', 'the notebook')
}
