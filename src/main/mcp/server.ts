/** The MCP server: Inkling's notes, to-dos and decks for an AI assistant, over stdio. */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { attachDb, checkVersion, getDb } from '../db'
import * as repos from '../repos'
import * as tools from './tools'

const INSTRUCTIONS = `Inkling is the user's notes app. It holds notes (Markdown in, Markdown out), to-dos (the checkbox lines inside notes, "- [ ] text") and flashcard decks.
Search or list before you write, and add to an existing note when one fits. A "- [ ]" line you write becomes a to-do on the user's Today list.
Nothing can be deleted or rewritten from here: notes only grow, to-dos can be ticked or reopened, decks only get new cards.`

const id = z.number().int().positive()
const limit = (max: number, fallback: number): z.ZodOptional<z.ZodNumber> =>
  z.number().int().min(1).max(max).optional().describe(`How many to return, ${fallback} if left out (at most ${max}).`)

const noteShape = {
  id: z.number().describe('The note id.'),
  title: z.string(),
  updatedAt: z.string().describe('Last change, ISO 8601 in UTC.')
}
const writeShape = { ...noteShape, todosCreated: z.number().describe('New to-dos made from "- [ ]" lines.') }
const todoShape = { id: z.number(), text: z.string(), done: z.boolean(), noteId: z.number().nullable() }

const READ = { readOnlyHint: true, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const

/** Wraps a handler: opens the data on first use, checks the schema, and returns text plus structure. */
function result<T extends object>(run: () => T): { content: Array<{ type: 'text'; text: string }>; structuredContent: Record<string, unknown> } {
  const value = run()
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> }
}

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
  const call = <T extends object>(fn: () => T, write = false): ReturnType<typeof result> =>
    result(() => {
      ready()
      const tx = getDb().transaction(() => {
        checkVersion(getDb())
        return fn()
      })
      return write ? tx.immediate() : tx()
    })

  const server = new McpServer({ name: 'inkling', title: 'Inkling', version }, { instructions: INSTRUCTIONS })

  server.registerTool(
    'search',
    {
      title: 'Search Inkling',
      description:
        'Full-text search over notes, to-dos and flashcard decks. Words match by prefix and all must appear. Returns ids to use with read_note, complete_todo or add_flashcards.',
      inputSchema: { query: z.string().min(1).describe('Words to look for.'), limit: limit(50, 20) },
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
    (args) => call(() => tools.search(args))
  )

  server.registerTool(
    'list_notes',
    {
      title: 'List notes',
      description: 'The notes, most recently changed first, with ids and titles.',
      inputSchema: { limit: limit(200, 50) },
      outputSchema: { notes: z.array(z.object(noteShape)) },
      annotations: READ
    },
    (args) => call(() => tools.listNotes(args))
  )

  server.registerTool(
    'read_note',
    {
      title: 'Read a note',
      description: 'One note as Markdown, with its title and last change. To-dos show as "- [ ]" and "- [x]" lines.',
      inputSchema: { id: id.describe('The note id, from search or list_notes.') },
      outputSchema: { ...noteShape, markdown: z.string() },
      annotations: READ
    },
    (args) => call(() => tools.readNote(args))
  )

  server.registerTool(
    'create_note',
    {
      title: 'Create a note',
      description:
        'Makes a new note from Markdown: headings, paragraphs (each line is one), bold, italic, ~~strike~~, ==highlight==, `code`, links, bullet and numbered lists, code blocks, quotes. "- [ ] text" lines become to-dos on Today ("- [x]" for done ones). A "Term :: Definition" line can be turned into flashcards in the app.',
      inputSchema: {
        title: z.string().min(1).max(300).describe('The note title.'),
        markdown: z.string().max(200_000).optional().describe('The body, without the title.')
      },
      outputSchema: writeShape,
      annotations: WRITE
    },
    (args) => call(() => tools.createNote(args), true)
  )

  server.registerTool(
    'append_to_note',
    {
      title: 'Add to a note',
      description:
        'Adds Markdown to the end of an existing note, with the same rules as create_note. What the note already says stays as it is.',
      inputSchema: {
        id: id.describe('The note id.'),
        markdown: z.string().min(1).max(200_000).describe('What to add.')
      },
      outputSchema: writeShape,
      annotations: WRITE
    },
    (args) => call(() => tools.appendToNote(args), true)
  )

  server.registerTool(
    'list_open_todos',
    {
      title: 'List open to-dos',
      description: 'The to-dos not yet done, from every note, with the note each one lives in.',
      inputSchema: { limit: limit(200, 50) },
      outputSchema: {
        todos: z.array(z.object({ id: z.number(), text: z.string(), noteId: z.number().nullable(), noteTitle: z.string() }))
      },
      annotations: READ
    },
    (args) => call(() => tools.listOpenTodos(args))
  )

  server.registerTool(
    'complete_todo',
    {
      title: 'Tick off a to-do',
      description: 'Marks a to-do as done. Its checkbox in the note is ticked too.',
      inputSchema: { id: id.describe('The to-do id, from list_open_todos or search.') },
      outputSchema: todoShape,
      annotations: { ...WRITE, idempotentHint: true }
    },
    (args) => call(() => tools.setTodoDone(args, true), true)
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
    (args) => call(() => tools.setTodoDone(args, false), true)
  )

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
    () => call(() => tools.listDecks())
  )

  server.registerTool(
    'add_flashcards',
    {
      title: 'Add flashcards',
      description:
        'Adds cards to a deck: give deckId for an existing deck, or deckName to use the deck with that name (made if there is none). A front can hold cloze deletions like "The {{c1::mitochondria}} makes energy", one card per number; the back may then stay empty.',
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
    (args) => call(() => tools.addFlashcards(args), true)
  )

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
