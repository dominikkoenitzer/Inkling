import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { Placeholder } from '@tiptap/extensions'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Bold, Italic, Heading1, Heading2, List, ListOrdered, ListChecks, Layers, FileDown, Trash2 } from 'lucide-react'
import { useApp, bumpData, registerFlush, deleteNote } from '@/stores/app'
import { extractNoteTaskItems, extractNoteCardLines, oneLine, safeParse } from '@/lib/parse'
import { loadNote, peekNote, saveFile, saveNote, syncNoteCards } from '@/lib/calls'
import { tiptapDocToMarkdown } from '@shared/markdown'
import { stampTaskIds } from '@shared/noteTasks'
import { IconBtn, titleFieldCls } from '@/components/ui'
import { keyLabel } from '@/lib/keys'
import { tickTodo } from '@/lib/editorKeys'
import { mergeDocs, mergeTitle, replaceChanged, type DocJson } from '@/lib/mergeDoc'
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
      'Mod-Enter': () => this.editor.commands.command(({ tr, dispatch }) => tickTodo(tr, !!dispatch))
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
  // Messages go to the app's toast, so the note never moves under them.
  const say = (message: string, durationMs: number): void => useApp.getState().showToast({ message, durationMs })

  const syncingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastItemsRef = useRef<NoteTaskItem[]>([])
  const notebookIdRef = useRef<number | null>(null)
  const titleRef = useRef('')
  // The content as last loaded or saved here, to spot a change made outside (an assistant via MCP).
  const contentRef = useRef<string | null>(null)
  // The stored title that content came with, the base the title is merged from.
  const baseTitleRef = useRef<string | null>(null)
  const savingRef = useRef(0)
  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const docRef = useRef<Record<string, unknown> | null>(null)

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

  const save = async (): Promise<void> => {
    const notebookId = notebookIdRef.current
    if (!editor || editor.isDestroyed || notebookId === null) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    savingRef.current++
    // Read everything now: on unmount the editor is gone by the time the IPC answers.
    readDoc()
    const schema = editor.schema
    // One save at a time, so a save never takes the one before it for a change made outside.
    const run = queueRef.current.then(() => store(notebookId, schema))
    queueRef.current = run.catch(() => undefined)
    try {
      await run
    } finally {
      savingRef.current--
    }
  }

  /** The editor's doc, or once the editor is gone, the last one read from it. */
  const readDoc = (): Record<string, unknown> => {
    if (editor && !editor.isDestroyed) docRef.current = editor.getJSON() as Record<string, unknown>
    return docRef.current!
  }

  const store = async (notebookId: number, schema: Schema): Promise<void> => {
    if (!editor) return
    for (;;) {
      // Written only over the title and content this edit started from; a save that lands on a note an
      // assistant changed meanwhile comes back, is merged with it, and goes again.
      const base = contentRef.current === null ? undefined : { title: baseTitleRef.current, content: contentRef.current }
      const json = readDoc()
      const items = extractNoteTaskItems(json)
      const patch = { title: titleRef.current || null, content: JSON.stringify(json) }
      let saved: Note | null
      if (!itemsEqual(items, lastItemsRef.current)) {
        // Rows and note in one step: an assistant's write between the two would be lost.
        const result = await api.notes.saveWithTasks(noteId, notebookId, patch, items, base)
        if (!result) return // note was deleted out from under us
        if (!result.ids) {
          takeIn(result.note, schema)
          continue
        }
        if (!editor.isDestroyed) {
          assignNodeIds(editor, 'taskItem', 'taskId', result.ids, syncingRef)
        } else {
          // Closed while saving: stamp the ids into the last doc itself, as they were saved.
          docRef.current = stampTaskIds(json, result.ids)
        }
        lastItemsRef.current = extractNoteTaskItems(safeParse(result.note.content) as Record<string, unknown>)
        bumpData('tasks')
        saved = result.note
      } else {
        saved = await api.notes.update(noteId, patch, base)
        if (!saved) return // note was deleted out from under us
        if (saved.content !== patch.content || saved.title !== patch.title) {
          takeIn(saved, schema)
          continue
        }
      }
      contentRef.current = saved.content
      baseTitleRef.current = saved.title
      setSavedAt(new Date())
      bumpData('notes')
      return
    }
  }

  /**
   * Merges what is stored now into this editor's changes, puts the result on screen without
   * moving the cursor, and makes the stored note the base of the next try.
   */
  const takeIn = (stored: Note, schema: Schema): void => {
    // Both read through the editor's schema, so a node written elsewhere compares like its own.
    const asEditorJson = (content: string): DocJson => {
      const doc = safeParse(content)
      try {
        return schema.nodeFromJSON(doc).toJSON() as DocJson
      } catch {
        return doc as DocJson
      }
    }
    const merged = mergeDocs(asEditorJson(contentRef.current ?? ''), readDoc() as DocJson, asEditorJson(stored.content))
    if (editor && !editor.isDestroyed) {
      const tr = replaceChanged(editor.state, schema.nodeFromJSON(merged))
      if (tr) {
        tr.setMeta('addToHistory', false)
        syncingRef.current = true
        editor.view.dispatch(tr)
        syncingRef.current = false
      }
    } else {
      docRef.current = merged as Record<string, unknown>
    }
    const title = mergeTitle(baseTitleRef.current, titleRef.current, stored.title) ?? ''
    if (title !== titleRef.current) {
      setTitle(title)
      titleRef.current = title
    }
    contentRef.current = stored.content
    baseTitleRef.current = stored.title
    // The task rows are the stored note's now, so the next sync starts from its lines.
    lastItemsRef.current = extractNoteTaskItems(safeParse(stored.content) as Record<string, unknown>)
  }

  // Tracked, so deleting this note waits for the save to land. A failed one takes "Saved" down.
  const doSave = (): Promise<boolean> =>
    saveNote(noteId, save()).then((saved) => {
      if (!saved) setSavedAt(null)
      return saved
    })

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
    baseTitleRef.current = note.title
    lastItemsRef.current = extractNoteTaskItems(safeParse(note.content) as Record<string, unknown>)
  }

  // initial load
  useEffect(() => {
    if (!editor) return
    let alive = true
    void loadNote(noteId).then((note) => {
      // Not loaded: the page stays read-only, so nothing typed can overwrite the note.
      if (note === undefined || !alive || editor.isDestroyed) return
      if (!note || note.deleted_at) {
        useApp.setState({ selectedNoteId: null })
        return
      }
      showNote(note)
      // A blank note starts at its title, so typing names it right away.
      if (!note.title && editor.isEmpty) titleInputRef.current?.focus()
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId])

  // Reload on focus or a write from outside when the note changed, unless an edit here is pending or saving.
  useEffect(() => {
    if (!editor) return
    let alive = true
    const idle = (): boolean => !timerRef.current && savingRef.current === 0 && contentRef.current !== null
    const onFocus = (): void => {
      if (!idle()) return
      void peekNote(noteId).then((note) => {
        // Not read: the page keeps what it shows, and the next save merges with what is stored.
        if (note === undefined || !alive || editor.isDestroyed || !idle()) return
        if (!note || note.deleted_at) {
          useApp.setState({ selectedNoteId: null })
          return
        }
        if (note.content !== contentRef.current || (note.title ?? '') !== titleRef.current) showNote(note)
      })
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('inkling:outside-write', onFocus)
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('inkling:outside-write', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId])

  // Flush a pending save on unmount, when the window loses focus and when it closes.
  useEffect(() => {
    const flush = (): void => {
      if (timerRef.current) void doSave()
    }
    // A delete from the sidebar starts the pending save first and waits for it.
    const unregister = registerFlush(noteId, flush)
    window.addEventListener('blur', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      unregister()
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
      say('Write a line like Term :: Definition or {{c1::word}} first.', 3500)
      return
    }
    // The note's own deck: made on the first run, updated in place on every later one.
    const synced = await syncNoteCards(
      noteId,
      notebookIdRef.current,
      titleRef.current || 'Untitled deck',
      lines.map(({ lineId, front, back }) => ({ lineId, front, back }))
    )
    if (!synced || editor.isDestroyed) return
    const { deck, lineIds } = synced
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
    const res = await saveFile(`${base}.md`, md)
    if (res?.saved) {
      say('Saved as Markdown.', 2500)
    } else if (res?.error) {
      say('Could not save the file.', 3500)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {editor && (
        <Toolbar
          editor={editor}
          onFlashcards={() => void makeFlashcards()}
          onExportMd={() => void exportMarkdown()}
          onDelete={() => void deleteNote(noteId, titleRef.current)}
          savedAt={savedAt}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 44px of toolbar plus 12px: the title sits at 56px, like Today and Flashcards. */}
        <div className="motion-rise mx-auto max-w-[720px] px-10 pb-32 pt-3">
          <textarea
            ref={titleInputRef}
            rows={1}
            value={title}
            onChange={(e) => {
              const next = oneLine(e.target.value)
              setTitle(next)
              titleRef.current = next
              scheduleSave()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                editor?.commands.focus('start')
              }
            }}
            placeholder="Title"
            aria-label="Title"
            className={`${titleFieldCls} mb-[calc(1rem-0.25em)] text-ink placeholder:text-faint`}
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
    // The name before the shortcut is what a screen reader says.
    <IconBtn title={title} label={title.split(' · ')[0]} active={active} onClick={action}>
      {icon}
    </IconBtn>
  )
}

function Toolbar({
  editor,
  onFlashcards,
  onExportMd,
  onDelete,
  savedAt
}: {
  editor: Editor
  onFlashcards: () => void
  onExportMd: () => void
  onDelete: () => void
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
      <ToolbarButton icon={<Bold size={16} />} title={`Bold · ${keyLabel('Ctrl+B')}`} active={editor.isActive('bold')} action={run((c) => c.toggleBold())} />
      <ToolbarButton icon={<Italic size={16} />} title={`Italic · ${keyLabel('Ctrl+I')}`} active={editor.isActive('italic')} action={run((c) => c.toggleItalic())} />
      <Divider />
      <ToolbarButton
        icon={<Heading1 size={16} />}
        title={`Heading 1 · ${keyLabel('Ctrl+Alt+1')} or type #`}
        active={editor.isActive('heading', { level: 1 })}
        action={run((c) => c.toggleHeading({ level: 1 }))}
      />
      <ToolbarButton
        icon={<Heading2 size={16} />}
        title={`Heading 2 · ${keyLabel('Ctrl+Alt+2')} or type ##`}
        active={editor.isActive('heading', { level: 2 })}
        action={run((c) => c.toggleHeading({ level: 2 }))}
      />
      <Divider />
      <ToolbarButton icon={<List size={16} />} title={`Bullet list · ${keyLabel('Ctrl+Shift+8')} or type -`} active={editor.isActive('bulletList')} action={run((c) => c.toggleBulletList())} />
      <ToolbarButton
        icon={<ListOrdered size={16} />}
        title={`Numbered list · ${keyLabel('Ctrl+Shift+7')} or type 1.`}
        active={editor.isActive('orderedList')}
        action={run((c) => c.toggleOrderedList())}
      />
      <ToolbarButton
        icon={<ListChecks size={16} />}
        title={`To-do · ${keyLabel('Ctrl+Shift+9')} or type [ ]. ${keyLabel('Ctrl+Enter')} ticks it.`}
        active={editor.isActive('taskList')}
        action={run((c) => c.toggleTaskList())}
      />
      <Divider />
      <IconBtn title="Turn Term :: Definition and {{c1::cloze}} lines into cards" label="Flashcards" onClick={onFlashcards} className="!w-auto gap-1.5 px-2 text-sm">
        <Layers size={15} />
        Flashcards
      </IconBtn>
      <IconBtn title="Export as Markdown" onClick={onExportMd}>
        <FileDown size={16} />
      </IconBtn>
      <span className="ml-auto pr-2 text-xs text-faint">{savedAt ? 'Saved' : ''}</span>
      <IconBtn title="Delete note" onClick={onDelete} className="hover:!text-danger">
        <Trash2 size={16} />
      </IconBtn>
    </div>
  )
}

function Divider(): React.JSX.Element {
  return <span className="mx-1 h-4 w-px bg-edge" aria-hidden />
}
