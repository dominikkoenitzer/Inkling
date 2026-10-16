import { useEffect, useState } from 'react'
import { Keyboard, Layers, Plus, Settings, Sun } from 'lucide-react'
import { useApp, useVersion, type View } from '@/stores/app'
import type { Note } from '@shared/types'

const api = window.inkling

/** One quiet column: the main action, two places to go, every note, then help and settings. */
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
      <div className="px-2 pt-3">
        <button
          type="button"
          title="New note (Ctrl+N)"
          onClick={() => void useApp.getState().newNote()}
          className="flex h-8 w-full items-center gap-2.5 rounded-md border border-edge bg-raised px-2.5 text-sm font-medium text-ink transition-colors hover:bg-hover"
        >
          <Plus size={16} className="text-accent-text" />
          New note
          <span className="ml-auto text-xs font-normal text-faint">Ctrl+N</span>
        </button>
      </div>

      <nav className="space-y-px px-2 pt-3">
        <NavRow view="today" current={view} icon={<Sun size={16} />} label="Today" hint="Ctrl+1" />
        <NavRow view="study" current={view} icon={<Layers size={16} />} label="Study" hint="Ctrl+2" count={due} />
      </nav>

      <div className="mx-4 mb-2 mt-3 border-t border-edge" />

      <div className="pb-1 pl-4 pr-2">
        <span className="text-xs font-medium text-faint">Notes</span>
      </div>

      <NotesList />

      <div className="space-y-px border-t border-edge px-2 py-2">
        <FooterRow icon={<Keyboard size={16} />} label="Shortcuts" title="Keyboard shortcuts (F1)" onClick={() => useApp.getState().setShortcutsOpen(true)} />
        <FooterRow icon={<Settings size={16} />} label="Settings" title="Settings (Ctrl+,)" onClick={() => useApp.getState().setSettingsOpen(true)} />
      </div>
    </aside>
  )
}

function FooterRow({ icon, label, title, onClick }: { icon: React.JSX.Element; label: string; title: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-hover hover:text-ink"
    >
      {icon}
      {label}
    </button>
  )
}

function NavRow({
  view,
  current,
  icon,
  label,
  hint,
  count
}: {
  view: View
  current: View
  icon: React.JSX.Element
  label: string
  hint: string
  count?: number
}): React.JSX.Element {
  const active = view === current
  return (
    <button
      type="button"
      title={`${label} (${hint})`}
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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {notes.length === 0 && <p className="px-2.5 py-1.5 text-sm text-faint">No notes yet.</p>}
      {notes.map((n) => {
        const active = view === 'notes' && selectedNoteId === n.id
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => useApp.getState().openNote(n.id)}
            aria-current={active ? 'page' : undefined}
            className={`flex h-8 w-full items-center rounded-md px-2.5 text-left text-sm transition-colors ${
              active ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{n.title?.trim() || 'Untitled'}</span>
          </button>
        )
      })}
    </div>
  )
}
