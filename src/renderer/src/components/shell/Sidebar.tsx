import { useEffect, useState } from 'react'
import { FileText, Layers, Plus, Settings, Sun, Trash2 } from 'lucide-react'
import { useApp, useVersion, bumpData, type View } from '@/stores/app'
import type { Note } from '@shared/types'

const api = window.inkling

/** One quiet column: three places to go, then every note. */
export function Sidebar(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const today = useApp((s) => s.today)
  const decksVersion = useVersion('decks')
  const [due, setDue] = useState(0)

  useEffect(() => {
    let stale = false
    void api.decks.list().then((decks) => !stale && setDue(decks.reduce((n, d) => n + d.due_count, 0)))
    return () => {
      stale = true
    }
  }, [decksVersion, today])

  return (
    <aside className="flex shrink-0 flex-col border-r border-edge bg-panel" style={{ width: 'var(--sidebar-w)' }}>
      <nav className="space-y-px px-2 pt-3">
        <NavRow view="today" current={view} icon={<Sun size={16} />} label="Today" />
        <NavRow view="study" current={view} icon={<Layers size={16} />} label="Study" count={due} />
        <button
          type="button"
          title="Settings (Ctrl+,)"
          onClick={() => useApp.getState().setSettingsOpen(true)}
          className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <Settings size={16} />
          Settings
        </button>
      </nav>

      <div className="mx-4 mb-2 mt-3 border-t border-edge" />

      <div className="flex items-center justify-between pb-1 pl-4 pr-2">
        <span className="text-xs font-medium text-faint">Notes</span>
        <button
          type="button"
          title="New note (Ctrl+N)"
          aria-label="New note"
          onClick={() => void useApp.getState().newNote()}
          className="flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <Plus size={15} />
        </button>
      </div>

      <NotesList />
    </aside>
  )
}

function NavRow({
  view,
  current,
  icon,
  label,
  count
}: {
  view: View
  current: View
  icon: React.JSX.Element
  label: string
  count?: number
}): React.JSX.Element {
  const active = view === current
  return (
    <button
      type="button"
      onClick={() => useApp.getState().setView(view)}
      aria-current={active ? 'page' : undefined}
      className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors ${
        active ? 'bg-active font-medium text-ink' : 'text-muted hover:bg-hover hover:text-ink'
      }`}
    >
      {icon}
      {label}
      {!!count && <span className={`ml-auto text-xs tabular-nums ${active ? 'text-muted' : 'text-faint'}`}>{count}</span>}
    </button>
  )
}

// Notes deleted while one undo toast is up: its Undo brings all of them back.
let undoable: number[] = []

function NotesList(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const selectedNoteId = useApp((s) => s.selectedNoteId)
  const version = useVersion('notes')
  const [notes, setNotes] = useState<Note[]>([])

  useEffect(() => {
    let stale = false
    void api.notes.list().then((n) => !stale && setNotes(n))
    return () => {
      stale = true
    }
  }, [version])

  const remove = (n: Note, row: HTMLElement | null): void => {
    // Keep the keyboard in the list: the next row, or the one before, takes focus.
    const next = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector('button') as HTMLElement | null
    if (useApp.getState().selectedNoteId === n.id) useApp.setState({ selectedNoteId: null })
    // Let the open editor flush its last edit before the note goes.
    setTimeout(() => {
      void api.notes.remove(n.id).then(() => {
        bumpData('notes')
        bumpData('tasks')
        // Opened again in the meantime: it is gone now, so close it.
        if (useApp.getState().selectedNoteId === n.id) useApp.setState({ selectedNoteId: null })
        // The list only grows while its own toast is still the one on screen.
        if (!useApp.getState().toast?.message.startsWith('Deleted')) undoable = []
        if (!undoable.includes(n.id)) undoable = [...undoable, n.id]
        const ids = undoable
        useApp.getState().showToast({
          message: ids.length === 1 ? `Deleted “${n.title?.trim() || 'Untitled'}”` : `Deleted ${ids.length} notes`,
          actionLabel: 'Undo',
          onAction: () => {
            undoable = []
            Promise.all(ids.map((id) => api.notes.restore(id))).then(
              () => {
                bumpData('notes')
                bumpData('tasks')
                useApp.getState().openNote(ids[ids.length - 1])
              },
              () => useApp.getState().showToast({ message: 'Could not bring the note back.' })
            )
          }
        })
      })
    }, 50)
    next?.focus()
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {notes.length === 0 && <p className="px-2.5 py-1.5 text-sm text-faint">No notes yet.</p>}
      {notes.map((n) => {
        const active = view === 'notes' && selectedNoteId === n.id
        const title = n.title?.trim() || 'Untitled'
        return (
          <div
            key={n.id}
            className={`group flex h-8 items-center rounded-md pr-1 text-sm transition-colors ${
              active ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            <button
              type="button"
              onClick={() => useApp.getState().openNote(n.id)}
              aria-current={active ? 'page' : undefined}
              className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md pl-2.5 text-left"
            >
              <FileText size={15} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate">{title}</span>
            </button>
            <button
              type="button"
              title="Delete note"
              aria-label={`Delete ${title}`}
              onClick={(e) => remove(n, (e.currentTarget.parentElement as HTMLElement | null) ?? null)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint opacity-0 transition-opacity hover:bg-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
