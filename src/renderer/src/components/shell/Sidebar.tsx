import { useEffect, useRef, useState } from 'react'
import { Keyboard, Layers, Plus, Settings, Sun } from 'lucide-react'
import { useApp, useVersion, type View } from '@/stores/app'
import { loadNotes, peekDecks } from '@/lib/calls'
import { ariaKeys, keyLabel, shortcutsKey } from '@/lib/keys'
import { useRows } from '@/lib/motion'
import type { Note } from '@shared/types'

/** One quiet column: the main action, two places to go, every note, then help and settings. */
export function Sidebar(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const today = useApp((s) => s.today)
  const decksVersion = useVersion('decks')
  const [due, setDue] = useState(0)

  useEffect(() => {
    let stale = false
    void peekDecks().then((decks) => decks && !stale && setDue(decks.reduce((n, d) => n + d.due_count, 0)))
    return () => {
      stale = true
    }
  }, [decksVersion, today])

  return (
    <aside className="flex shrink-0 flex-col border-r border-edge bg-panel" style={{ width: 'var(--sidebar-w)' }}>
      <div className="px-2 pt-3">
        <button
          type="button"
          title={`New note (${keyLabel('Ctrl+N')})`}
          onClick={() => void useApp.getState().newNote()}
          aria-keyshortcuts={ariaKeys('Ctrl+N')}
          className="flex h-8 w-full items-center gap-2.5 rounded-md border border-edge bg-raised px-2.5 text-sm font-medium text-ink transition-colors hover:bg-hover"
        >
          <Plus size={16} className="text-accent-text" />
          New note
          <span aria-hidden="true" className="ml-auto text-xs font-normal text-faint">
            {keyLabel('Ctrl+N')}
          </span>
        </button>
      </div>

      <nav className="space-y-px px-2 pt-3">
        <NavRow view="today" current={view} icon={<Sun size={16} />} label="Today" keys="Ctrl+1" />
        <NavRow view="study" current={view} icon={<Layers size={16} />} label="Flashcards" keys="Ctrl+2" count={due} />
      </nav>

      <div className="mx-4 mb-2 mt-3 border-t border-edge" />

      <div className="pb-1 pl-4 pr-2">
        <span className="text-xs font-medium text-faint">Notes</span>
      </div>

      <NotesList />

      <div className="space-y-px border-t border-edge px-2 py-2">
        <FooterRow icon={<Keyboard size={16} />} label="Shortcuts" title="Keyboard shortcuts" keys={shortcutsKey()} onClick={() => useApp.getState().setShortcutsOpen(true)} />
        <FooterRow icon={<Settings size={16} />} label="Settings" title="Settings" keys="Ctrl+," onClick={() => useApp.getState().setSettingsOpen(true)} />
      </div>
    </aside>
  )
}

function FooterRow({
  icon,
  label,
  title,
  keys,
  onClick
}: {
  icon: React.JSX.Element
  label: string
  title: string
  keys: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={`${title} (${keyLabel(keys)})`}
      aria-keyshortcuts={ariaKeys(keys)}
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
  keys,
  count
}: {
  view: View
  current: View
  icon: React.JSX.Element
  label: string
  keys: string
  count?: number
}): React.JSX.Element {
  const active = view === current
  return (
    <button
      type="button"
      title={`${label} (${keyLabel(keys)})`}
      aria-keyshortcuts={ariaKeys(keys)}
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
  // Null until the first list arrives, so an empty list is never claimed before then.
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [failed, setFailed] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const { rows, onAnimationEnd, row } = useRows(notes, (n) => n.id, listRef)

  useEffect(() => {
    let stale = false
    void loadNotes().then((n) => {
      if (stale) return
      if (n) setNotes(n)
      setFailed(!n)
    })
    return () => {
      stale = true
    }
  }, [version])

  // Up and Down walk the list once a note in it has focus.
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button')).filter((b) => !b.closest('[inert]'))
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    e.preventDefault()
    buttons[Math.max(0, Math.min(buttons.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" onKeyDown={onKey} onAnimationEnd={onAnimationEnd}>
      {notes === null && failed && <p className="px-2.5 py-1.5 text-sm text-faint">Could not load the notes.</p>}
      {rows?.length === 0 && <p className="px-2.5 py-1.5 text-sm text-faint">No notes yet.</p>}
      {rows?.map((r) => {
        const n = r.item
        const active = view === 'notes' && selectedNoteId === n.id
        return (
          <button
            key={r.key}
            {...row(r)}
            type="button"
            onClick={() => useApp.getState().openNote(n.id)}
            aria-current={active ? 'page' : undefined}
            className={`motion-row flex h-8 w-full items-center rounded-md px-2.5 text-left text-sm transition-colors ${
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
