import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { Placeholder } from '@tiptap/extensions'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Bold, Italic, Heading1, Heading2, List, ListOrdered, ListChecks, Layers, FileDown } from 'lucide-react'
import { useApp, bumpData } from '@/stores/app'
import { extractNoteTaskItems, extractNoteCardLines } from '@/lib/parse'
import { tiptapDocToMarkdown } from '@shared/markdown'
import { stampTaskIds } from '@shared/noteTasks'
import { IconBtn } from '@/components/ui'
import type { Note, NoteTaskItem } from '@shared/types'

const api = window.inkling

/** TaskItem carrying the linked task row's id, so a note's checkboxes are its tasks. */
const LinkedTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskId: {
        default: null,
        // A new line made by Enter is a new task, not a second copy of this one.
        keepOnSplit: false,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute('data-task-id')
          return v ? Number(v) : null
        },
        renderHTML: (attrs) => (attrs.taskId ? { 'data-task-id': String(attrs.taskId) } : {})
      }
    }
  }
})

/**
 * Paragraphs carry the id of the card line an earlier sync made them, so a reworded line
 * updates its own cards. Not copied onto the next paragraph when Enter splits one.
 */
const CardLineId = Extension.create({
  name: 'cardLineId',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          cardLine: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => {
              const v = el.getAttribute('data-card-line')
              return v ? Number(v) : null
            },
            renderHTML: (attrs) => (attrs.cardLine ? { 'data-card-line': String(attrs.cardLine) } : {})
          }
        }
      }
    ]
  }
})

/** Ctrl+Enter ticks or unticks the to-do the cursor is in; anywhere else the key works as before. */
const ToggleTodo = Extension.create({
  name: 'toggleTodo',
  // Ahead of the hard break, which also listens for Mod-Enter.
  priority: 101,
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () =>
        this.editor.commands.command(({ tr, dispatch }) => {
          const { $from } = tr.selection
          // In a code block the key leaves the block, as it always did.
          if ($from.parent.type.spec.code) return false
          for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth)
            if (node.type.name !== 'taskItem') continue
            if (dispatch) tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked: !node.attrs.checked })
            return true
          }
          return false
        })
    }
  }
})

function itemsEqual(a: NoteTaskItem[], b: NoteTaskItem[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => x.taskId === b[i].taskId && x.title === b[i].title && x.checked === b[i].checked)
}

export function PageEditor({ noteId }: { noteId: number }): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [flashMsg, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setFlashMsg = (msg: string | null, ms = 3000): void => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlash(msg)
    if (msg) flashTimer.current = setTimeout(() => setFlash(null), ms)
  }

  const syncingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastItemsRef = useRef<NoteTaskItem[]>([])
  const notebookIdRef = useRef<number | null>(null)
  const titleRef = useRef('')
  // The content as last loaded or saved here, to spot a change made outside (an assistant via MCP).
  const contentRef = useRef<string | null>(null)
  const savingRef = useRef(0)

  const editor = useEditor({
    // Read-only until the note has loaded, so nothing typed early is overwritten.
    editable: false,
    extensions: [
      // StarterKit v3 bundles Underline and Link; configure them here rather than registering twice.
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: true } }),
      Highlight,
      Placeholder.configure({ placeholder: 'Start writing. Type # for a heading, [ ] for a to-do.' }),
      TaskList,
      LinkedTaskItem.configure({ nested: true }),
      CardLineId,
      ToggleTodo
    ],
    onUpdate: () => {
      if (syncingRef.current) return
      scheduleSave()
    }
  })

  const scheduleSave = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave(), 400)
  }

  const doSave = async (): Promise<void> => {
    const notebookId = notebookIdRef.current
    if (!editor || editor.isDestroyed || notebookId === null) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    savingRef.current++
    try {
      // Read everything now: on unmount the editor is gone by the time the IPC answers.
      let json = editor.getJSON() as Record<string, unknown>
      const title = titleRef.current || null
      const items = extractNoteTaskItems(json)
      if (!itemsEqual(items, lastItemsRef.current)) {
        const ids = await api.notes.syncTasks(noteId, notebookId, items)
        if (!editor.isDestroyed) {
          assignNodeIds(editor, 'taskItem', 'taskId', ids, syncingRef)
          json = editor.getJSON() as Record<string, unknown>
        } else {
          // Closed while syncing: stamp the ids into the snapshot itself, so the saved note
          // still knows which task each checkbox is.
          json = stampTaskIds(json, ids)
        }
        lastItemsRef.current = extractNoteTaskItems(json)
        bumpData('tasks')
      }

      const content = JSON.stringify(json)
      const saved = await api.notes.update(noteId, { title, content })
      if (!saved) return // note was deleted out from under us
      contentRef.current = content
      setSavedAt(new Date())
      bumpData('notes')
    } finally {
      savingRef.current--
    }
  }

  /** Puts a stored note into the editor, kept out of the undo history. */
  const showNote = (note: Note): void => {
    if (!editor) return
    syncingRef.current = true
    // Kept out of the undo history, or Ctrl+Z right after opening would empty the note.
    editor.chain().setMeta('addToHistory', false).setContent(safeParse(note.content), { emitUpdate: false }).run()
    editor.setEditable(true, false)
    syncingRef.current = false
    setTitle(note.title ?? '')
    titleRef.current = note.title ?? ''
    notebookIdRef.current = note.notebook_id
    contentRef.current = note.content
    lastItemsRef.current = extractNoteTaskItems(safeParse(note.content) as Record<string, unknown>)
  }

  // initial load
  useEffect(() => {
    if (!editor) return
    let alive = true
    void api.notes.get(noteId).then((note: Note | null) => {
      if (!alive || editor.isDestroyed) return
      if (!note || note.deleted_at) {
        useApp.setState({ selectedNoteId: null })
        return
      }
      showNote(note)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId])

  // Reload on focus when the note changed outside, unless an edit here is pending or saving.
  useEffect(() => {
    if (!editor) return
    let alive = true
    const idle = (): boolean => !timerRef.current && savingRef.current === 0 && contentRef.current !== null
    const onFocus = (): void => {
      if (!idle()) return
      void api.notes.get(noteId).then((note: Note | null) => {
        if (!alive || editor.isDestroyed || !idle()) return
        if (!note || note.deleted_at) {
          useApp.setState({ selectedNoteId: null })
          return
        }
        if (note.content !== contentRef.current || (note.title ?? '') !== titleRef.current) showNote(note)
      })
    }
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId])

  // Flush a pending save on unmount, when the window loses focus and when it closes.
  useEffect(() => {
    const flush = (): void => {
      if (timerRef.current) void doSave()
    }
    window.addEventListener('blur', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('blur', flush)
      window.removeEventListener('beforeunload', flush)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const makeFlashcards = async (): Promise<void> => {
    if (!editor || notebookIdRef.current === null) return
    const lines = extractNoteCardLines(editor.getJSON() as Record<string, unknown>)
    if (lines.length === 0) {
      setFlashMsg('Write a line like Term :: Definition or {{c1::word}} first.', 3500)
      return
    }
    // The note's own deck: made on the first run, updated in place on every later one.
    const { deck, lineIds } = await api.notes.syncCards(
      noteId,
      notebookIdRef.current,
      titleRef.current || 'Untitled deck',
      lines.map(({ lineId, front, back }) => ({ lineId, front, back }))
    )
    if (editor.isDestroyed) return
    // Stamped by paragraph position: continuation lines and plain text get no id.
    const perParagraph: number[] = []
    lines.forEach((l, i) => (perParagraph[l.paragraph] = lineIds[i]))
    assignNodeIds(editor, 'paragraph', 'cardLine', perParagraph, syncingRef)
    await doSave() // keep the stamped ids, or the next sync matches by text alone
    bumpData('decks')
    useApp.getState().openDeck(deck.id)
  }

  const exportMarkdown = async (): Promise<void> => {
    if (!editor) return
    await doSave() // flush latest edits so the file matches what's on screen
    const md = tiptapDocToMarkdown(editor.getJSON())
    const base = (titleRef.current || 'note').replace(/[\\/:*?"<>|]/g, '').trim() || 'note'
    const res = await api.app.saveFile(`${base}.md`, md)
    if (res.saved) {
      setFlashMsg('Saved as Markdown', 2500)
    } else if (res.error) {
      setFlashMsg('Could not save the file.', 3500)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {editor && <Toolbar editor={editor} onFlashcards={() => void makeFlashcards()} onExportMd={() => void exportMarkdown()} savedAt={savedAt} />}
      {flashMsg && (
        <div role="status" className="mx-auto mt-1 rounded-md bg-hover px-3 py-1 text-xs text-muted">
          {flashMsg}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-10 pb-32 pt-10">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              titleRef.current = e.target.value
              scheduleSave()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                editor?.commands.focus('start')
              }
            }}
            placeholder="Untitled"
            aria-label="Title"
            className="font-display mb-4 w-full bg-transparent text-[32px] font-semibold leading-tight tracking-tight text-ink placeholder:text-faint"
          />
          <EditorContent editor={editor} className="text-[15.5px] [&>div]:min-h-[50vh]" />
        </div>
      </div>
    </div>
  )
}

/**
 * Stamp database ids onto nodes of one type, in document order, matching the order the
 * main process returned. Kept out of the undo history so Ctrl+Z cannot un-assign an id.
 */
function assignNodeIds(
  editor: Editor,
  nodeType: string,
  attr: string,
  ids: number[],
  syncingRef: { current: boolean }
): void {
  const { state, view } = editor
  const tr = state.tr
  let i = 0
  let changed = false
  state.doc.descendants((node, pos) => {
    if (node.type.name === nodeType) {
      const want = ids[i++]
      if (want !== undefined && want > 0 && node.attrs[attr] !== want) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: want })
        changed = true
      }
    }
    return true
  })
  if (changed) {
    tr.setMeta('addToHistory', false)
    syncingRef.current = true
    view.dispatch(tr)
    syncingRef.current = false
  }
}

function safeParse(content: string): object {
  try {
    return JSON.parse(content)
  } catch {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }
}

/* --------------------------------- Toolbar -------------------------------- */

function ToolbarButton({
  icon,
  title,
  action,
  active
}: {
  icon: React.JSX.Element
  title: string
  action: () => void
  active?: boolean
}): React.JSX.Element {
  return (
    <IconBtn title={title} active={active} onClick={action}>
      {icon}
    </IconBtn>
  )
}

function Toolbar({
  editor,
  onFlashcards,
  onExportMd,
  savedAt
}: {
  editor: Editor
  onFlashcards: () => void
  onExportMd: () => void
  savedAt: Date | null
}): React.JSX.Element {
  // subscribe to selection/transaction changes so active states repaint
  const [, setTick] = useState(0)
  useEffect(() => {
    const rerender = (): void => setTick((t) => t + 1)
    editor.on('transaction', rerender)
    editor.on('selectionUpdate', rerender)
    return () => {
      editor.off('transaction', rerender)
      editor.off('selectionUpdate', rerender)
    }
  }, [editor])

  // A fresh chain per click: a chain runs as it is built, so one made during render would
  // pull focus into the editor on every repaint.
  const run = (f: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>): (() => void) => () => void f(editor.chain().focus()).run()

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-wrap items-center gap-0.5 px-8 pt-3">
      <ToolbarButton icon={<Bold size={16} />} title="Bold (Ctrl+B)" active={editor.isActive('bold')} action={run((c) => c.toggleBold())} />
      <ToolbarButton icon={<Italic size={16} />} title="Italic (Ctrl+I)" active={editor.isActive('italic')} action={run((c) => c.toggleItalic())} />
      <Divider />
      <ToolbarButton
        icon={<Heading1 size={16} />}
        title="Heading 1 (or type #)"
        active={editor.isActive('heading', { level: 1 })}
        action={run((c) => c.toggleHeading({ level: 1 }))}
      />
      <ToolbarButton
        icon={<Heading2 size={16} />}
        title="Heading 2"
        active={editor.isActive('heading', { level: 2 })}
        action={run((c) => c.toggleHeading({ level: 2 }))}
      />
      <Divider />
      <ToolbarButton icon={<List size={16} />} title="Bullet list (or type -)" active={editor.isActive('bulletList')} action={run((c) => c.toggleBulletList())} />
      <ToolbarButton
        icon={<ListOrdered size={16} />}
        title="Numbered list (or type 1.)"
        active={editor.isActive('orderedList')}
        action={run((c) => c.toggleOrderedList())}
      />
      <ToolbarButton
        icon={<ListChecks size={16} />}
        title="Task list (or type []). Items become real tasks"
        active={editor.isActive('taskList')}
        action={run((c) => c.toggleTaskList())}
      />
      <Divider />
      <IconBtn title="Turn Term :: Definition and {{c1::cloze}} lines into cards" onClick={onFlashcards} className="!w-auto gap-1.5 px-2 text-sm">
        <Layers size={15} />
        Flashcards
      </IconBtn>
      <IconBtn title="Export as Markdown" onClick={onExportMd}>
        <FileDown size={16} />
      </IconBtn>
      <span className="ml-auto pr-1 text-xs text-faint">{savedAt ? 'Saved' : ''}</span>
    </div>
  )
}

function Divider(): React.JSX.Element {
  return <span className="mx-1 h-4 w-px bg-edge" aria-hidden />
}
