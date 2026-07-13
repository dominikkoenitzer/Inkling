import { useEffect, useState } from 'react'
import {
  FileText,
  CheckSquare,
  CalendarDays,
  GraduationCap,
  Search,
  Plus,
  StickyNote,
  Pin,
  Trash2,
  MoreHorizontal,
  Sun,
  CalendarRange,
  Layers,
  BookOpen
} from 'lucide-react'
import { format } from 'date-fns'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { RAMPS, COLOR_KEYS, isColorKey } from '@/lib/colors'
import { Modal, Field, inputCls, Button, IconBtn } from '@/components/ui'
import type { Note, Deck, ModuleTab, ColorKey } from '@shared/types'

const api = window.inkling

const TABS: Array<{ id: ModuleTab; icon: React.JSX.Element; label: string }> = [
  { id: 'notes', icon: <FileText size={15} />, label: 'Notes' },
  { id: 'tasks', icon: <CheckSquare size={15} />, label: 'Tasks' },
  { id: 'calendar', icon: <CalendarDays size={15} />, label: 'Calendar' },
  { id: 'study', icon: <GraduationCap size={15} />, label: 'Study' }
]

export function Sidebar(): React.JSX.Element {
  const app = useApp()
  const notebook = app.notebooks.find((n) => n.id === app.activeNotebookId)
  const [editing, setEditing] = useState(false)

  return (
    <aside className="flex w-60 shrink-0 flex-col rounded-tl-xl border-l border-t border-edge bg-panel">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <h1 className="truncate text-[15px] font-bold">{notebook?.name ?? 'Inkling'}</h1>
        {notebook && (
          <IconBtn title="Notebook options" onClick={() => setEditing(true)}>
            <MoreHorizontal size={15} />
          </IconBtn>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1 px-2 pb-2 pt-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => app.setTab(t.id)}
            title={t.label}
            className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10.5px] font-medium transition-colors ${
              app.tab === t.id ? 'text-white' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
            style={app.tab === t.id ? { background: 'var(--accent)' } : undefined}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => app.setPaletteOpen(true)}
        className="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-edge bg-sunken px-2.5 py-1.5 text-sm text-faint hover:text-muted"
      >
        <Search size={14} />
        Search everything…
        <span className="ml-auto rounded border border-edge px-1 text-[10px]">Ctrl K</span>
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {notebook ? (
          <>
            {app.tab === 'notes' && <NotesList notebookId={notebook.id} />}
            {app.tab === 'tasks' && <TasksSidebar />}
            {app.tab === 'calendar' && <CalendarSidebar />}
            {app.tab === 'study' && <StudySidebar notebookId={notebook.id} />}
          </>
        ) : (
          <p className="px-2 py-4 text-sm text-muted">Create a notebook to get going — the + button on the left.</p>
        )}
      </div>

      {editing && notebook && <NotebookModal notebookId={notebook.id} onClose={() => setEditing(false)} />}
    </aside>
  )
}

/* ------------------------------- Notes list ------------------------------- */

function NotesList({ notebookId }: { notebookId: number }): React.JSX.Element {
  const { notesView, setNotesView, selectedNoteId, setSelectedNote, notebooks } = useApp()
  const version = useVersion('notes')
  const [pages, setPages] = useState<Note[]>([])
  const journal = notebooks.find((n) => n.is_journal === 1)

  useEffect(() => {
    void api.notes.list(notebookId, 'page').then(setPages)
  }, [notebookId, version])

  const newPage = async (): Promise<void> => {
    const note = await api.notes.create({ notebook_id: notebookId, type: 'page' })
    bumpData('notes')
    setNotesView('pages')
    setSelectedNote(note.id)
  }

  const openJournalToday = async (): Promise<void> => {
    if (!journal) return
    const title = format(new Date(), 'EEE, MMM d yyyy')
    const existing = (await api.notes.list(journal.id, 'page')).find((n) => n.title === title)
    const note =
      existing ??
      (await api.notes.create({
        notebook_id: journal.id,
        type: 'page',
        title,
        content: JSON.stringify({
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
            { type: 'paragraph' }
          ]
        })
      }))
    bumpData('notes')
    useApp.getState().openNote(journal.id, note.id)
  }

  return (
    <div className="fade-up">
      <div className="mb-2 flex gap-1">
        <button
          type="button"
          onClick={() => void newPage()}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-edge bg-raised py-1.5 text-xs font-medium hover:bg-active"
        >
          <Plus size={13} /> Page
        </button>
        <button
          type="button"
          onClick={() => setNotesView('board')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg border border-edge py-1.5 text-xs font-medium ${
            notesView === 'board' ? 'bg-active text-ink' : 'bg-raised hover:bg-active'
          }`}
        >
          <StickyNote size={13} /> Sticky board
        </button>
      </div>

      {journal && (
        <button
          type="button"
          onClick={() => void openJournalToday()}
          className="mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-hover hover:text-ink"
        >
          <BookOpen size={14} style={{ color: 'var(--accent-text)' }} /> Today’s journal
        </button>
      )}

      <SectionLabel>Pages</SectionLabel>
      {pages.length === 0 && <p className="px-2 py-2 text-xs text-faint">No pages yet — hit “+ Page” above.</p>}
      {pages.map((n) => (
        <div
          key={n.id}
          className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm ${
            notesView === 'pages' && selectedNoteId === n.id ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink'
          }`}
          onClick={() => {
            setNotesView('pages')
            setSelectedNote(n.id)
          }}
        >
          {n.pinned === 1 && <Pin size={11} className="shrink-0" style={{ color: 'var(--accent-text)' }} />}
          <span className="truncate">{n.title || 'Untitled'}</span>
          <span className="ml-auto hidden shrink-0 gap-0.5 group-hover:flex">
            <IconBtn
              title={n.pinned ? 'Unpin' : 'Pin'}
              onClick={(e) => {
                e.stopPropagation()
                void api.notes.update(n.id, { pinned: n.pinned ? 0 : 1 }).then(() => bumpData('notes'))
              }}
            >
              <Pin size={12} />
            </IconBtn>
            <IconBtn
              title="Delete page"
              onClick={(e) => {
                e.stopPropagation()
                if (selectedNoteId === n.id) setSelectedNote(null)
                void api.notes.remove(n.id).then(() => bumpData('notes'))
              }}
            >
              <Trash2 size={12} />
            </IconBtn>
          </span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------ Tasks sidebar ------------------------------ */

function TasksSidebar(): React.JSX.Element {
  const { smartView, setSmartView } = useApp()
  const version = useVersion('tasks')
  const [counts, setCounts] = useState({ today: 0, week: 0 })

  useEffect(() => {
    void Promise.all([api.tasks.smart('today'), api.tasks.smart('week')]).then(([t, w]) => setCounts({ today: t.length, week: w.length }))
  }, [version])

  const Item = ({
    id,
    icon,
    label,
    count
  }: {
    id: 'today' | 'week' | null
    icon: React.JSX.Element
    label: string
    count?: number
  }): React.JSX.Element => (
    <button
      type="button"
      onClick={() => setSmartView(id)}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
        smartView === id ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink'
      }`}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-auto rounded-full px-1.5 text-[11px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
          {count}
        </span>
      )}
    </button>
  )

  return (
    <div className="fade-up">
      <SectionLabel>Smart views</SectionLabel>
      <Item id="today" icon={<Sun size={14} />} label="Today" count={counts.today} />
      <Item id="week" icon={<CalendarRange size={14} />} label="This Week" count={counts.week} />
      <SectionLabel className="mt-3">This notebook</SectionLabel>
      <Item id={null} icon={<Layers size={14} />} label="All tasks" />
    </div>
  )
}

/* ---------------------------- Calendar sidebar ---------------------------- */

function CalendarSidebar(): React.JSX.Element {
  const version = useVersion('tasks') + useVersion('events')
  const [dueSoon, setDueSoon] = useState<Array<{ id: number; title: string; due: string }>>([])

  useEffect(() => {
    void api.tasks.smart('week').then((tasks) =>
      setDueSoon(
        tasks.slice(0, 12).map((t) => ({
          id: t.id,
          title: t.title,
          due: t.due_date ? format(new Date(t.due_date), 'EEE d MMM') : ''
        }))
      )
    )
  }, [version])

  return (
    <div className="fade-up">
      <SectionLabel>Due this week</SectionLabel>
      {dueSoon.length === 0 && <p className="px-2 py-2 text-xs text-faint">Nothing due this week — enjoy it ✨</p>}
      {dueSoon.map((t) => (
        <div key={t.id} className="rounded-lg px-2 py-1.5 text-sm text-muted">
          <div className="truncate text-ink">{t.title}</div>
          <div className="text-[11px] text-faint">{t.due}</div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------ Study sidebar ------------------------------ */

function StudySidebar({ notebookId }: { notebookId: number }): React.JSX.Element {
  const { selectedDeckId, setSelectedDeck } = useApp()
  const version = useVersion('decks')
  const [decks, setDecks] = useState<Deck[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    void api.decks.list(notebookId).then(setDecks)
  }, [notebookId, version])

  const createDeck = async (): Promise<void> => {
    if (!name.trim()) return
    const deck = await api.decks.create(notebookId, name.trim())
    bumpData('decks')
    setSelectedDeck(deck.id)
    setAdding(false)
    setName('')
  }

  return (
    <div className="fade-up">
      <button
        type="button"
        onClick={() => setSelectedDeck(null)}
        className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
          selectedDeckId === null ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink'
        }`}
      >
        <GraduationCap size={14} /> Study home
      </button>
      <SectionLabel>Decks</SectionLabel>
      {decks.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => setSelectedDeck(d.id)}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
            selectedDeckId === d.id ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink'
          }`}
        >
          <span className="truncate">{d.name}</span>
          {d.due_count > 0 && (
            <span className="ml-auto rounded-full px-1.5 text-[11px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
              {d.due_count}
            </span>
          )}
        </button>
      ))}
      {adding ? (
        <input
          autoFocus
          className={`${inputCls} mt-1`}
          value={name}
          placeholder="Deck name…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createDeck()
            if (e.key === 'Escape') setAdding(false)
          }}
          onBlur={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-faint hover:bg-hover hover:text-ink"
        >
          <Plus size={14} /> New deck
        </button>
      )}
    </div>
  )
}

/* --------------------------------- Shared --------------------------------- */

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <div className={`px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-faint ${className}`}>{children}</div>
}

function NotebookModal({ notebookId, onClose }: { notebookId: number; onClose: () => void }): React.JSX.Element {
  const { notebooks, refreshNotebooks } = useApp()
  const nb = notebooks.find((n) => n.id === notebookId)!
  const [name, setName] = useState(nb.name)
  const [color, setColor] = useState<ColorKey>(isColorKey(nb.color) ? nb.color : 'teal')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async (): Promise<void> => {
    await api.notebooks.update(notebookId, { name: name.trim() || nb.name, color })
    await refreshNotebooks()
    onClose()
  }
  const remove = async (): Promise<void> => {
    await api.notebooks.remove(notebookId)
    await refreshNotebooks()
    bumpData('notes')
    bumpData('tasks')
    bumpData('events')
    bumpData('decks')
    onClose()
  }

  return (
    <Modal title="Notebook settings" onClose={onClose}>
      <Field label="Name">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Color">
        <div className="flex gap-2">
          {COLOR_KEYS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => setColor(c)}
              className={`h-8 w-8 rounded-full transition-transform ${color === c ? 'scale-110 ring-2' : 'hover:scale-105'}`}
              style={{ background: RAMPS[c][500], ['--tw-ring-color' as never]: RAMPS[c][700] }}
            />
          ))}
        </div>
      </Field>
      <div className="mt-4 flex items-center justify-between">
        {confirmDelete ? (
          <Button variant="danger" onClick={() => void remove()}>
            Really delete everything?
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Delete notebook
          </Button>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
