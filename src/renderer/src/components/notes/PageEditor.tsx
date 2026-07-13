import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Minus,
  Undo2,
  Redo2,
  Sparkles,
  Code2,
  FileDown
} from 'lucide-react'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { extractNoteTaskItems, extractFlashcardPairs } from '@/lib/parse'
import { tiptapDocToMarkdown } from '@shared/markdown'
import { tiptapDocToHtml } from '@shared/tiptapHtml'
import { IconBtn } from '@/components/ui'
import type { Notebook, Note, NoteTaskItem } from '@shared/types'

const api = window.inkling

/** TaskItem carrying the linked task row's id, so note checkboxes ARE tasks (§7). */
const LinkedTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskId: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute('data-task-id')
          return v ? Number(v) : null
        },
        renderHTML: (attrs) => (attrs.taskId ? { 'data-task-id': String(attrs.taskId) } : {})
      }
    }
  }
})

function itemsEqual(a: NoteTaskItem[], b: NoteTaskItem[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => x.taskId === b[i].taskId && x.title === b[i].title && x.checked === b[i].checked)
}

export function PageEditor({ noteId, notebook }: { noteId: number; notebook: Notebook }): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [flashMsg, setFlashMsg] = useState<string | null>(null)
  const notesVersion = useVersion('notes')

  const syncingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastItemsRef = useRef<NoteTaskItem[]>([])
  const loadedUpdatedAtRef = useRef<string>('')
  const titleRef = useRef('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Highlight,
      Link.configure({ openOnClick: true }),
      Placeholder.configure({ placeholder: 'Write anything… try “# ” for a heading or “[] ” for a task' }),
      TaskList,
      LinkedTaskItem.configure({ nested: true })
    ],
    onUpdate: () => {
      if (syncingRef.current) return
      scheduleSave()
    }
  })

  const scheduleSave = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave(), 400) // §7 debounced auto-save
  }

  const doSave = async (): Promise<void> => {
    if (!editor || editor.isDestroyed) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const json = editor.getJSON() as Record<string, unknown>
    const items = extractNoteTaskItems(json)
    if (!itemsEqual(items, lastItemsRef.current)) {
      const prevChecked = new Map(lastItemsRef.current.filter((i) => i.taskId !== null).map((i) => [i.taskId, i.checked]))
      const ids = await api.notes.syncTasks(noteId, notebook.id, items)
      assignTaskIds(editor, ids, syncingRef)
      const after = extractNoteTaskItems(editor.getJSON() as Record<string, unknown>)
      if (after.some((i) => i.checked && i.taskId !== null && prevChecked.get(i.taskId) === false)) {
        useApp.getState().celebrate()
      }
      lastItemsRef.current = after
      bumpData('tasks')
    }
    const saved = await api.notes.update(noteId, {
      title: titleRef.current || null,
      content: JSON.stringify(editor.getJSON())
    })
    if (!saved) return // note was deleted out from under us
    loadedUpdatedAtRef.current = saved.updated_at
    setSavedAt(new Date())
    bumpData('notes')
  }

  // initial load
  useEffect(() => {
    if (!editor) return
    let alive = true
    void api.notes.get(noteId).then((note: Note | null) => {
      if (!alive || !note || editor.isDestroyed) return
      syncingRef.current = true
      editor.commands.setContent(safeParse(note.content))
      syncingRef.current = false
      setTitle(note.title ?? '')
      titleRef.current = note.title ?? ''
      loadedUpdatedAtRef.current = note.updated_at
      lastItemsRef.current = extractNoteTaskItems(safeParse(note.content) as Record<string, unknown>)
    })
    return () => {
      alive = false
    }
  }, [editor, noteId])

  // reload when the note changed elsewhere (tasks view toggled a linked checkbox, quick-add, …)
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return
    void api.notes.get(noteId).then((note) => {
      if (!note || editor.isDestroyed || editor.isFocused) return
      if (note.updated_at !== loadedUpdatedAtRef.current) {
        syncingRef.current = true
        editor.commands.setContent(safeParse(note.content))
        syncingRef.current = false
        setTitle(note.title ?? '')
        titleRef.current = note.title ?? ''
        loadedUpdatedAtRef.current = note.updated_at
        lastItemsRef.current = extractNoteTaskItems(safeParse(note.content) as Record<string, unknown>)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesVersion, editor, noteId])

  // flush pending save on unmount / window blur (§7: flushed on blur/close)
  useEffect(() => {
    const flush = (): void => {
      if (timerRef.current) void doSave()
    }
    window.addEventListener('blur', flush)
    return () => {
      window.removeEventListener('blur', flush)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const makeFlashcards = async (): Promise<void> => {
    if (!editor) return
    const pairs = extractFlashcardPairs(JSON.stringify(editor.getJSON()))
    if (pairs.length === 0) {
      setFlashMsg('No “Term :: Definition” lines found in this note yet.')
      setTimeout(() => setFlashMsg(null), 3500)
      return
    }
    const deck = await api.decks.createFromPairs(notebook.id, titleRef.current || 'Untitled deck', pairs)
    bumpData('decks')
    useApp.getState().celebrate()
    useApp.getState().openDeck(notebook.id, deck.id)
  }

  const exportMarkdown = async (): Promise<void> => {
    if (!editor) return
    await doSave() // flush latest edits so the file matches what's on screen
    const md = tiptapDocToMarkdown(editor.getJSON())
    const base = (titleRef.current || 'note').replace(/[\\/:*?"<>|]/g, '').trim() || 'note'
    const res = await api.app.saveFile(`${base}.md`, md)
    if (res.saved) {
      setFlashMsg('Exported to Markdown ✓')
      setTimeout(() => setFlashMsg(null), 2500)
    } else if (res.error) {
      setFlashMsg('Export failed — could not write the file.')
      setTimeout(() => setFlashMsg(null), 3500)
    }
  }

  const exportPdf = async (): Promise<void> => {
    if (!editor) return
    await doSave()
    const body = tiptapDocToHtml(editor.getJSON())
    const base = (titleRef.current || 'note').replace(/[\\/:*?"<>|]/g, '').trim() || 'note'
    const res = await api.app.savePdf(body, titleRef.current || 'Untitled', `${base}.pdf`)
    if (res.saved) {
      setFlashMsg('Exported to PDF ✓')
      setTimeout(() => setFlashMsg(null), 2500)
    } else if (res.error) {
      setFlashMsg('Export failed — could not write the PDF.')
      setTimeout(() => setFlashMsg(null), 3500)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {editor && (
        <Toolbar
          editor={editor}
          onFlashcards={() => void makeFlashcards()}
          onExportMd={() => void exportMarkdown()}
          onExportPdf={() => void exportPdf()}
          savedAt={savedAt}
        />
      )}
      {flashMsg && <div className="mx-auto mt-2 rounded-lg border border-edge bg-raised px-3 py-1.5 text-xs text-muted pop-in">{flashMsg}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-10 pb-24 pt-8">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              titleRef.current = e.target.value
              scheduleSave()
            }}
            placeholder="Untitled"
            className="mb-2 w-full bg-transparent text-3xl font-bold text-ink placeholder:text-faint"
          />
          <EditorContent editor={editor} className="[&>div]:min-h-[50vh]" />
        </div>
      </div>
    </div>
  )
}

function assignTaskIds(editor: Editor, ids: number[], syncingRef: { current: boolean }): void {
  const { state, view } = editor
  const tr = state.tr
  let i = 0
  let changed = false
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem') {
      const want = ids[i++]
      if (want !== undefined && node.attrs.taskId !== want) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, taskId: want })
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

function Toolbar({
  editor,
  onFlashcards,
  onExportMd,
  onExportPdf,
  savedAt
}: {
  editor: Editor
  onFlashcards: () => void
  onExportMd: () => void
  onExportPdf: () => void
  savedAt: Date | null
}): React.JSX.Element {
  // subscribe to selection/transaction changes so active states repaint
  const [, setTick] = useState(0)
  const [exportOpen, setExportOpen] = useState(false)
  useEffect(() => {
    const rerender = (): void => setTick((t) => t + 1)
    editor.on('transaction', rerender)
    editor.on('selectionUpdate', rerender)
    return () => {
      editor.off('transaction', rerender)
      editor.off('selectionUpdate', rerender)
    }
  }, [editor])

  const B = ({
    icon,
    title,
    action,
    active
  }: {
    icon: React.JSX.Element
    title: string
    action: () => void
    active?: boolean
  }): React.JSX.Element => (
    <IconBtn title={title} active={active} onClick={action}>
      {icon}
    </IconBtn>
  )

  const c = editor.chain().focus()

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-edge bg-sunken px-3 py-1.5">
      <B icon={<Bold size={15} />} title="Bold (Ctrl+B)" active={editor.isActive('bold')} action={() => c.toggleBold().run()} />
      <B icon={<Italic size={15} />} title="Italic (Ctrl+I)" active={editor.isActive('italic')} action={() => c.toggleItalic().run()} />
      <B
        icon={<UnderlineIcon size={15} />}
        title="Underline (Ctrl+U)"
        active={editor.isActive('underline')}
        action={() => c.toggleUnderline().run()}
      />
      <B icon={<Strikethrough size={15} />} title="Strikethrough" active={editor.isActive('strike')} action={() => c.toggleStrike().run()} />
      <B icon={<Highlighter size={15} />} title="Highlight" active={editor.isActive('highlight')} action={() => c.toggleHighlight().run()} />
      <B icon={<Code size={15} />} title="Inline code" active={editor.isActive('code')} action={() => c.toggleCode().run()} />
      <Divider />
      <B
        icon={<Heading1 size={15} />}
        title="Heading 1 (or type #)"
        active={editor.isActive('heading', { level: 1 })}
        action={() => c.toggleHeading({ level: 1 }).run()}
      />
      <B
        icon={<Heading2 size={15} />}
        title="Heading 2"
        active={editor.isActive('heading', { level: 2 })}
        action={() => c.toggleHeading({ level: 2 }).run()}
      />
      <B
        icon={<Heading3 size={15} />}
        title="Heading 3"
        active={editor.isActive('heading', { level: 3 })}
        action={() => c.toggleHeading({ level: 3 }).run()}
      />
      <Divider />
      <B icon={<List size={15} />} title="Bullet list (or type -)" active={editor.isActive('bulletList')} action={() => c.toggleBulletList().run()} />
      <B
        icon={<ListOrdered size={15} />}
        title="Numbered list (or type 1.)"
        active={editor.isActive('orderedList')}
        action={() => c.toggleOrderedList().run()}
      />
      <B
        icon={<ListChecks size={15} />}
        title="Task list (or type []) — items become real tasks"
        active={editor.isActive('taskList')}
        action={() => c.toggleTaskList().run()}
      />
      <B icon={<Quote size={15} />} title="Quote (or type >)" active={editor.isActive('blockquote')} action={() => c.toggleBlockquote().run()} />
      <B icon={<Code2 size={15} />} title="Code block" active={editor.isActive('codeBlock')} action={() => c.toggleCodeBlock().run()} />
      <B icon={<Minus size={15} />} title="Divider" action={() => c.setHorizontalRule().run()} />
      <Divider />
      <B icon={<Undo2 size={15} />} title="Undo (Ctrl+Z)" action={() => c.undo().run()} />
      <B icon={<Redo2 size={15} />} title="Redo (Ctrl+Y)" action={() => c.redo().run()} />
      <Divider />
      <IconBtn title="Make flashcards from “Term :: Definition” lines" onClick={onFlashcards} className="!w-auto gap-1 px-2 text-xs font-medium">
        <Sparkles size={14} style={{ color: 'var(--accent-text)' }} />
        Flashcards
      </IconBtn>
      <div className="relative">
        <IconBtn title="Export note…" active={exportOpen} onClick={() => setExportOpen((v) => !v)}>
          <FileDown size={15} />
        </IconBtn>
        {exportOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} />
            <div className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-lg border border-edge bg-raised py-1 shadow-lg">
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-hover"
                onClick={() => {
                  setExportOpen(false)
                  onExportMd()
                }}
              >
                Markdown (.md)
              </button>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-hover"
                onClick={() => {
                  setExportOpen(false)
                  onExportPdf()
                }}
              >
                PDF (.pdf)
              </button>
            </div>
          </>
        )}
      </div>
      <span className="ml-auto pr-1 text-[11px] text-faint">
        {savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Auto-saves as you type'}
      </span>
    </div>
  )
}

function Divider(): React.JSX.Element {
  return <span className="mx-1 h-4 w-px bg-edge" aria-hidden />
}
