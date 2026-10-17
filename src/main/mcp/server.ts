/** The MCP server: Inkling's notes, to-dos and flashcards for an AI assistant, over stdio. */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'fs'
import { join } from 'path'
import { attachDb, checkVersion, getDb } from '../db'
import * as repos from '../repos'
import * as tools from './tools'

const INSTRUCTIONS = `Inkling is the user's notes app. It holds notes (Markdown in, Markdown out), to-dos (the checkbox lines inside notes, "- [ ] text") and flashcards.
Search or list before you write, and add to an existing note when one fits. A "- [ ]" line you write becomes a to-do on the user's Today list. A "Term :: Definition" line in a note becomes a flashcard with make_flashcards_from_note.
For changes inside a note, prefer append_to_note, replace_section or edit_note over rewriting it, and read it first. undo_edit takes back an edit made in this session.
Nothing is ever deleted for good from here: delete_note moves a note to the trash for ${repos.TRASH_RETENTION_DAYS} days and restore_note brings it back.`

const id = z.number().int().positive()
const limit = (max: number, fallback: number): z.ZodOptional<z.ZodNumber> =>
  z.number().int().min(1).max(max).optional().describe(`How many to return, ${fallback} if left out (at most ${max}).`)
const markdown = z.string().max(200_000)

const noteShape = {
  id: z.number().describe('The note id.'),
  title: z.string(),
  updatedAt: z.string().describe('Last change, ISO 8601 in UTC.')
}
const writeShape = { ...noteShape, todosCreated: z.number().describe('New to-dos made from "- [ ]" lines.') }
const todoShape = { id: z.number(), text: z.string(), done: z.boolean(), noteId: z.number().nullable() }
const openTodo = z.object({
  id: z.number(),
  text: z.string(),
  noteId: z.number().nullable(),
  noteTitle: z.string(),
  due: z.string().nullable().describe('Due day (YYYY-MM-DD, local), if the to-do has one.'),
  overdue: z.boolean()
})

const READ = { readOnlyHint: true, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const
/** Changes or hides what is there, with a way back (undo_edit, restore_note). */
const CHANGE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const

type Result = { content: Array<{ type: 'text'; text: string }>; structuredContent: Record<string, unknown> }

/** Wraps a handler's value as text plus structure. */
function result<T extends object>(value: T): Result {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> }
}

/** How many copies made before an assistant's first write are kept. */
const KEEP_BACKUPS = 3

export function createServer(dataDir: string, version: string): McpServer {
  let attached = false
  // Opened on the first call, not at start: Inkling may be opened (or updated) after the
  // assistant started the server. Every call checks the schema again.
  const ready = (): void => {
    if (attached) return
    attachDb(dataDir)
    attached = true
  }
  // One transaction per call with the schema check inside it. Writes take the lock up front:
  // a deferred one would fail at once if the app committed between its first read and write.
  const run = <T extends object>(fn: () => T, write: boolean): Result => {
    ready()
    const tx = getDb().transaction(() => {
      checkVersion(getDb())
      return fn()
    })
    return result(write ? tx.immediate() : tx())
  }

  // Before the first write of a session the data is copied into backups/, next to the copies
  // the app makes when it starts, so whatever an assistant does can be undone by hand.
  let backedUp = false
  const backupOnce = async (): Promise<void> => {
    if (backedUp) return
    const dir = join(dataDir, 'backups')
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    await getDb().backup(join(dir, `assistant-${stamp}.db`))
    backedUp = true
    const old = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('assistant-') && f.endsWith('.db'))
      .sort()
    for (const f of old.slice(0, -KEEP_BACKUPS)) fs.unlinkSync(join(dir, f))
  }

  const read =
    <A>(fn: (args: A) => object) =>
    (args: A): Result =>
      run(() => fn(args), false)
  const write =
    <A>(fn: (args: A) => object) =>
    async (args: A): Promise<Result> => {
      ready()
      checkVersion(getDb())
      await backupOnce()
      return run(() => fn(args), true)
    }

  const server = new McpServer({ name: 'inkling', title: 'Inkling', version }, { instructions: INSTRUCTIONS })

  /* ---------------------------------- Notes --------------------------------- */

  server.registerTool(
    'search',
    {
      title: 'Search Inkling',
      description:
        'Full-text search over notes, to-dos and flashcard decks. Words match by prefix and all must appear. Returns ids to use with read_note, complete_todo or add_flashcards.',
      inputSchema: { query: z.string().min(1).max(500).describe('Words to look for.'), limit: limit(50, 20) },
      outputSchema: {
        results: z.array(
          z.object({
            type: z.enum(['note', 'todo', 'deck']),
            id: z.number().describe('The id of the note, to-do or deck.'),
            title: z.string(),
            snippet: z.string().describe('The matching text, shortened.'),
            noteId: z.number().nullable().describe('The note a note or to-do lives in, null for a deck.')
          })
        )
      },
      annotations: READ
    },
    read(tools.search)
  )

  server.registerTool(
    'list_notes',
    {
      title: 'List notes',
      description:
        'Notes, most recently changed first, with ids and titles. Use changedSince for what changed lately, offset to page on while "more" is true, and inTrash to find a deleted note for restore_note.',
      inputSchema: {
        limit: limit(200, 50),
        offset: z.number().int().min(0).optional().describe('How many to skip, for the next page.'),
        changedSince: z.string().max(40).optional().describe('Only notes changed at or after this date or time, ISO 8601.'),
        inTrash: z.boolean().optional().describe('List the notes in the trash instead, newest deletion first.')
      },
      outputSchema: {
        notes: z.array(z.object({ ...noteShape, deletedAt: z.string().optional().describe('When it went to the trash.') })),
        more: z.boolean().describe('True when there are more notes after this page.')
      },
      annotations: READ
    },
    read(tools.listNotes)
  )

  server.registerTool(
    'read_note',
    {
      title: 'Read a note',
      description:
        'One note as Markdown, with its title and last change. To-dos show as "- [ ]" and "- [x]" lines. Give heading to read only the section under it. This Markdown is what edit_note matches against.',
      inputSchema: {
        id: id.describe('The note id, from search or list_notes.'),
        heading: z.string().min(1).max(300).optional().describe('Only the section under this heading, without the # marks.')
      },
      outputSchema: { ...noteShape, markdown: z.string() },
      annotations: READ
    },
    read(tools.readNote)
  )

  server.registerTool(
    'create_note',
    {
      title: 'Create a note',
      description:
        'Makes a new note from Markdown: headings, paragraphs (each line is one), bold, italic, ~~strike~~, ==highlight==, `code`, links, bullet and numbered lists, code blocks, quotes. "- [ ] text" lines become to-dos on Today ("- [x]" for done ones). "Term :: Definition" lines can become flashcards with make_flashcards_from_note.',
      inputSchema: {
        title: z.string().min(1).max(300).describe('The note title.'),
        markdown: markdown.optional().describe('The body, without the title.')
      },
      outputSchema: writeShape,
      annotations: WRITE
    },
    write(tools.createNote)
  )

  server.registerTool(
    'append_to_note',
    {
      title: 'Add to a note',
      description:
        'Adds Markdown to the end of a note, or to the end of the section under heading. Same Markdown as create_note. Everything already there stays as it is.',
      inputSchema: {
        id: id.describe('The note id.'),
        markdown: markdown.min(1).describe('What to add.'),
        heading: z.string().min(1).max(300).optional().describe('Add at the end of the section under this heading instead.')
      },
      outputSchema: writeShape,
      annotations: WRITE
    },
    write(tools.appendToNote)
  )

  server.registerTool(
    'replace_section',
    {
      title: 'Replace a section',
      description:
        'Replaces what stands under one heading, up to the next heading of the same or a higher level. The heading itself stays. To-do lines that keep their text keep their to-do. Returns what the section held before; undo_edit puts it back.',
      inputSchema: {
        id: id.describe('The note id.'),
        heading: z.string().min(1).max(300).describe('The heading text, without the # marks. Must be unique in the note.'),
        markdown: markdown.describe('The new section body. Empty clears the section.')
      },
      outputSchema: { ...writeShape, previous: z.string().describe('The section body before, as Markdown.') },
      annotations: CHANGE
    },
    write(tools.replaceNoteSection)
  )

  server.registerTool(
    'edit_note',
    {
      title: 'Edit a note',
      description:
        'Swaps one piece of text for another. oldText must match the Markdown from read_note exactly and only once (add surrounding words if it is not unique), or set replaceAll. Only the lines it touches change. undo_edit takes it back.',
      inputSchema: {
        id: id.describe('The note id.'),
        oldText: z.string().min(1).max(50_000).describe('The exact text to replace, as read_note shows it.'),
        newText: z.string().max(200_000).describe('The text to put there. Empty removes it.'),
        replaceAll: z.boolean().optional().describe('Replace every match instead of exactly one.')
      },
      outputSchema: { ...writeShape, replaced: z.number().describe('How many matches were replaced.') },
      annotations: CHANGE
    },
    write(tools.editNote)
  )

  server.registerTool(
    'undo_edit',
    {
      title: 'Undo an edit',
      description:
        'Takes back the last edit made to a note in this session by append_to_note, replace_section or edit_note. Call it again to go further back. Refused if the note was changed since.',
      inputSchema: { id: id.describe('The note id.') },
      outputSchema: { ...noteShape, left: z.number().describe('Earlier edits that can still be undone.') },
      annotations: WRITE
    },
    write(tools.undoEdit)
  )

  server.registerTool(
    'rename_note',
    {
      title: 'Rename a note',
      description: 'Gives a note a new title.',
      inputSchema: { id: id.describe('The note id.'), title: z.string().min(1).max(300).describe('The new title.') },
      outputSchema: { ...noteShape, previousTitle: z.string() },
      annotations: { ...WRITE, idempotentHint: true }
    },
    write(tools.renameNote)
  )

  server.registerTool(
    'delete_note',
    {
      title: 'Move a note to the trash',
      description: `Moves a note to the trash, with its to-dos and its flashcards. It stays there for ${repos.TRASH_RETENTION_DAYS} days; restore_note brings it back. Ask the user before you delete.`,
      inputSchema: { id: id.describe('The note id.') },
      outputSchema: { ...noteShape, inTrash: z.literal(true), keptForDays: z.number() },
      annotations: CHANGE
    },
    write(tools.deleteNote)
  )

  server.registerTool(
    'restore_note',
    {
      title: 'Restore a note',
      description: 'Brings a note back from the trash, to-dos and flashcards included. list_notes with inTrash shows what is there.',
      inputSchema: { id: id.describe('The note id.') },
      outputSchema: noteShape,
      annotations: { ...WRITE, idempotentHint: true }
    },
    write(tools.restoreNote)
  )

  /* ---------------------------------- To-dos -------------------------------- */

  server.registerTool(
    'today',
    {
      title: 'Today',
      description:
        "What the user's Today page shows: the open to-dos (dated ones first) and how many flashcards are due, per deck. A good first call for planning a day or a study session.",
      inputSchema: {},
      outputSchema: {
        date: z.string().describe('Today, YYYY-MM-DD in local time.'),
        todos: z.array(openTodo).describe('Open to-dos, at most 50.'),
        openTodos: z.number().describe('All open to-dos.'),
        flashcardsDue: z.number(),
        decks: z.array(z.object({ id: z.number(), name: z.string(), due: z.number() })).describe('Decks with cards due now.')
      },
      annotations: READ
    },
    read(() => tools.today())
  )

  server.registerTool(
    'list_open_todos',
    {
      title: 'List open to-dos',
      description: 'The to-dos not yet done, from every note, dated ones first, with the note each one lives in.',
      inputSchema: { limit: limit(200, 50) },
      outputSchema: { todos: z.array(openTodo) },
      annotations: READ
    },
    read(tools.listOpenTodos)
  )

  server.registerTool(
    'complete_todo',
    {
      title: 'Tick off a to-do',
      description: 'Marks a to-do as done. Its checkbox in the note is ticked too.',
      inputSchema: { id: id.describe('The to-do id, from list_open_todos, today or search.') },
      outputSchema: todoShape,
      annotations: { ...WRITE, idempotentHint: true }
    },
    write((args: { id: number }) => tools.setTodoDone(args, true))
  )

  server.registerTool(
    'reopen_todo',
    {
      title: 'Reopen a to-do',
      description: 'Marks a done to-do as open again. Its checkbox in the note is cleared too.',
      inputSchema: { id: id.describe('The to-do id.') },
      outputSchema: todoShape,
      annotations: { ...WRITE, idempotentHint: true }
    },
    write((args: { id: number }) => tools.setTodoDone(args, false))
  )

  /* -------------------------------- Flashcards ------------------------------ */

  server.registerTool(
    'list_decks',
    {
      title: 'List flashcard decks',
      description: 'The flashcard decks with how many cards each has and how many are due for review now.',
      inputSchema: {},
      outputSchema: {
        decks: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
            cards: z.number(),
            due: z.number().describe('Cards due for review now.'),
            noteId: z.number().nullable().describe('The note the deck is made from, if any.')
          })
        )
      },
      annotations: READ
    },
    read(() => tools.listDecks())
  )

  server.registerTool(
    'list_due_flashcards',
    {
      title: 'List due flashcards',
      description:
        'Cards due for review now, oldest first, as question and answer (a cloze card asks one gap, shown as [...]). To quiz the user: show the question, let them answer, show the answer, then call grade_flashcard.',
      inputSchema: { deckId: id.optional().describe('Only this deck.'), limit: limit(100, 20) },
      outputSchema: {
        cards: z.array(
          z.object({
            id: z.number(),
            deckId: z.number(),
            deckName: z.string(),
            question: z.string(),
            answer: z.string(),
            isNew: z.boolean().describe('Never reviewed before.')
          })
        ),
        due: z.number().describe('All cards due now in the decks asked for.')
      },
      annotations: READ
    },
    read(tools.listDueFlashcards)
  )

  server.registerTool(
    'grade_flashcard',
    {
      title: 'Grade a flashcard',
      description:
        'Records how a review went and schedules the card, the same as the review screen: again (forgot), hard, good or easy. Grade by what the user answered; when unsure, ask them.',
      inputSchema: {
        id: id.describe('The card id, from list_due_flashcards.'),
        grade: z.enum(['again', 'hard', 'good', 'easy'])
      },
      outputSchema: {
        id: z.number(),
        grade: z.string(),
        nextReview: z.string().describe('When the card is due again, ISO 8601 in UTC.'),
        intervalDays: z.number()
      },
      annotations: WRITE
    },
    write(tools.gradeFlashcard)
  )

  server.registerTool(
    'add_flashcards',
    {
      title: 'Add flashcards',
      description:
        'Adds cards to a deck: give deckId for an existing deck, or deckName to use the deck with that name (made if there is none). A front can hold cloze deletions like "The {{c1::mitochondria}} makes energy", one card per number; the back may then stay empty. To keep cards with the note they come from, use make_flashcards_from_note instead.',
      inputSchema: {
        deckId: id.optional().describe('An existing deck id, from list_decks.'),
        deckName: z.string().min(1).max(200).optional().describe('A deck name, used instead of deckId.'),
        cards: z
          .array(z.object({ front: z.string().min(1).max(5000), back: z.string().max(5000).optional() }))
          .min(1)
          .max(200)
      },
      outputSchema: { deckId: z.number(), deckName: z.string(), added: z.number().describe('Cards made, one per cloze number.') },
      annotations: WRITE
    },
    write(tools.addFlashcards)
  )

  server.registerTool(
    'make_flashcards_from_note',
    {
      title: 'Make flashcards from a note',
      description:
        'Turns the note\'s card lines into its own deck, like the Make flashcards button: "Term :: Definition" lines and lines with cloze gaps like "The {{c1::heart}} pumps blood". Run it again after adding lines; reworded lines keep their review history. Write the lines with append_to_note first.',
      inputSchema: { id: id.describe('The note id.') },
      outputSchema: {
        deckId: z.number(),
        deckName: z.string(),
        cards: z.number().describe('Cards in the deck now.'),
        added: z.number().describe('Cards made by this call.'),
        due: z.number()
      },
      annotations: WRITE
    },
    write(tools.makeFlashcardsFromNote)
  )

  /* -------------------------------- Resources ------------------------------- */

  server.registerResource(
    'note',
    new ResourceTemplate('inkling://note/{id}', {
      list: () => {
        ready()
        checkVersion(getDb())
        return {
          resources: repos
            .listNotes()
            .slice(0, 200)
            .map((n) => ({ uri: `inkling://note/${n.id}`, name: n.title?.trim() || 'Untitled', mimeType: 'text/markdown' }))
        }
      }
    }),
    { title: 'Note', description: 'A note as Markdown.', mimeType: 'text/markdown' },
    (uri, vars) => {
      ready()
      checkVersion(getDb())
      const note = tools.readNote({ id: Number(vars['id']) })
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: note.markdown }] }
    }
  )

  server.registerResource(
    'today',
    'inkling://today',
    { title: 'Today', description: 'Open to-dos and flashcards due, as on the Today page.', mimeType: 'application/json' },
    (uri) => {
      ready()
      checkVersion(getDb())
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(tools.today(), null, 2) }] }
    }
  )

  /* --------------------------------- Prompts -------------------------------- */

  const say = (text: string): { messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> } => ({
    messages: [{ role: 'user', content: { type: 'text', text } }]
  })

  server.registerPrompt(
    'plan_my_day',
    { title: 'Plan my day', description: 'Looks at Today in Inkling and suggests an order for the day.' },
    () =>
      say(
        'Call the Inkling tool "today". Then suggest a short plan for my day: which to-dos first (overdue and dated ones lead) and when to review the flashcards that are due. Keep it brief. Do not tick anything off unless I say so.'
      )
  )

  server.registerPrompt(
    'quiz_me',
    {
      title: 'Quiz me',
      description: 'Reviews the flashcards that are due, one at a time, and records each answer.',
      argsSchema: { deck: z.string().optional().describe('A deck name; all decks if left out.') }
    },
    ({ deck }) =>
      say(
        `Quiz me on my Inkling flashcards${deck ? ` from the deck "${deck}" (find its id with list_decks)` : ''}. Get the due cards with list_due_flashcards. Ask one question at a time and wait for my answer. Then show the answer, say briefly how I did and call grade_flashcard: "again" if I got it wrong, "hard" if barely, "good" if right, "easy" if instant. Stop when no cards are due or when I say stop, and tell me how it went.`
      )
  )

  server.registerPrompt(
    'flashcards_from_note',
    {
      title: 'Flashcards from a note',
      description: 'Writes card lines into a note and turns them into its deck.',
      argsSchema: { note: z.string().describe('The note title, or words from it.') }
    },
    ({ note }) =>
      say(
        `Find my Inkling note "${note}" with search and read it. Pick the facts worth remembering and add them as card lines with append_to_note under the heading "Flashcards" (start that heading at the end of the note if there is none): one "Term :: Definition" or one sentence with a {{c1::gap}} per line, short and one fact each, skipping any the note already has. Then call make_flashcards_from_note and tell me how many cards it made.`
      )
  )

  return server
}

/** Serves on stdin and stdout until the client closes the pipe. */
export async function runServer(dataDir: string, version: string): Promise<void> {
  const server = createServer(dataDir, version)
  await server.connect(new StdioServerTransport())
  process.stdin.on('end', () => {
    try {
      getDb().close()
    } catch {
      // never opened
    }
    // Let the last reply reach the pipe first.
    process.stdout.write('', () => process.exit(0))
  })
}
