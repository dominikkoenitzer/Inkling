import { useEffect, useState } from 'react'
import {
  FileText,
  CheckSquare,
  GraduationCap,
  Search,
  Plus,
  Trash2,
  MoreHorizontal,
  Sun,
  Percent,
  BarChart3
} from 'lucide-react'
import { format } from 'date-fns'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { RAMPS, COLOR_KEYS, isColorKey, ramp } from '@/lib/colors'
import { subjectAverage } from '@shared/grades'
import { Modal, Field, inputCls, Button, IconBtn } from '@/components/ui'
import { UserBar } from '@/components/shell/UserBar'
import type { Note, Deck, Grade, Task, ModuleTab, ColorKey } from '@shared/types'

const api = window.inkling

const TABS: Array<{ id: ModuleTab; icon: React.JSX.Element; label: string }> = [
  { id: 'today', icon: <Sun size={16} />, label: 'Today' },
  { id: 'notes', icon: <FileText size={16} />, label: 'Notes' },
  { id: 'tasks', icon: <CheckSquare size={16} />, label: 'Tasks' },
  { id: 'study', icon: <GraduationCap size={16} />, label: 'Study' },
  { id: 'grades', icon: <Percent size={16} />, label: 'Grades' },
  { id: 'stats', icon: <BarChart3 size={16} />, label: 'Progress' }
]

export function Sidebar(): React.JSX.Element {
  const app = useApp()
  const notebook = app.notebooks.find((n) => n.id === app.activeNotebookId)
  const [editing, setEditing] = useState(false)

  return (
    <aside className="flex w-60 shrink-0 flex-col rounded-tl-xl border-l border-t border-edge bg-panel">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <h1 className="min-w-0 truncate text-base font-bold">{notebook?.name ?? 'Inkling'}</h1>
        {notebook && (
          <IconBtn title="Notebook options" onClick={() => setEditing(true)}>
            <MoreHorizontal size={16} />
          </IconBtn>
        )}
      </div>

      <nav className="space-y-0.5 px-2 pb-2 pt-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => app.setTab(t.id)}
            className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-sm font-medium transition-colors ${
              app.tab === t.id ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      <button
        type="button"
        onClick={() => app.setPaletteOpen(true)}
        className="mx-2 mb-2 flex items-center gap-2 rounded-lg bg-app px-2 py-1.5 text-sm text-faint transition-colors hover:text-muted"
      >
        <Search size={16} />
        Search everything…
        <span className="ml-auto rounded-sm border border-edge px-1 text-[11px]">Ctrl K</span>
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {notebook ? (
          <>
            {app.tab === 'today' && <TodaySidebar />}
            {app.tab === 'notes' && <NotesList notebookId={notebook.id} />}
            {app.tab === 'study' && <StudySidebar notebookId={notebook.id} />}
            {app.tab === 'grades' && <GradesSidebar />}
          </>
        ) : (
          <p className="px-2 py-4 text-sm text-muted">Create a notebook to get going. The + button on the left is waiting.</p>
        )}
      </div>

      <UserBar />

      {editing && notebook && <NotebookModal notebookId={notebook.id} onClose={() => setEditing(false)} />}
    </aside>
  )
}

/* ------------------------------- Notes list ------------------------------- */

function NotesList({ notebookId }: { notebookId: number }): React.JSX.Element {
  const { selectedNoteId, setSelectedNote } = useApp()
  const version = useVersion('notes')
  const [pages, setPages] = useState<Note[]>([])

  useEffect(() => {
    void api.notes.list(notebookId).then(setPages)
  }, [notebookId, version])

  const newPage = async (): Promise<void> => {
    const note = await api.notes.create({ notebook_id: notebookId })
    bumpData('notes')
    setSelectedNote(note.id)
  }

  return (
    <div className="fade-up">
      <button
        type="button"
        onClick={() => void newPage()}
        className="mb-2 flex w-full items-center justify-center gap-1 rounded-lg bg-raised py-1.5 text-xs font-medium transition-all hover:bg-active active:scale-95"
      >
        <Plus size={14} /> New page
      </button>

      <SectionLabel>Pages</SectionLabel>
      {pages.length === 0 && <p className="px-2 py-2 text-xs text-faint">No pages yet. Hit “New page” above.</p>}
      {pages.map((n) => (
        <div
          key={n.id}
          className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
            selectedNoteId === n.id ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink'
          }`}
          onClick={() => setSelectedNote(n.id)}
        >
          <span className="truncate">{n.title || 'Untitled'}</span>
          <span className="ml-auto hidden shrink-0 gap-0.5 group-hover:flex">
            <IconBtn
              title="Delete page"
              onClick={(e) => {
                e.stopPropagation()
                if (selectedNoteId === n.id) setSelectedNote(null)
                void api.notes.remove(n.id).then(() => {
                  bumpData('notes')
                  useApp.getState().showToast({
                    message: `Deleted “${n.title?.trim() || 'Untitled'}”`,
                    actionLabel: 'Undo',
                    onAction: () => {
                      void api.notes.restore(n.id).then(() => {
                        bumpData('notes')
                        useApp.getState().setSelectedNote(n.id)
                      })
                    }
                  })
                })
              }}
            >
              <Trash2 size={14} />
            </IconBtn>
          </span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------ Today sidebar ------------------------------ */

function TodaySidebar(): React.JSX.Element {
  const version = useVersion('tasks')
  const { openTask } = useApp()
  const [dueSoon, setDueSoon] = useState<Task[]>([])

  useEffect(() => {
    void api.tasks.smart('week').then((tasks) => setDueSoon(tasks.slice(0, 12)))
  }, [version])

  return (
    <div className="fade-up">
      <SectionLabel>Due this week</SectionLabel>
      {dueSoon.length === 0 && <div className="rounded-lg bg-sunken px-3 py-3 text-xs text-faint">Nothing due this week. Enjoy it.</div>}
      {dueSoon.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => openTask(t.notebook_id, t.id)}
          className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-hover"
        >
          <span className="block truncate text-ink">{t.title}</span>
          <span className="block text-xs text-faint">{t.due_date ? format(new Date(t.due_date), 'EEE d MMM') : ''}</span>
        </button>
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
        className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
          selectedDeckId === null ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink'
        }`}
      >
        <GraduationCap size={16} /> Study home
      </button>
      <SectionLabel>Decks</SectionLabel>
      {decks.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => setSelectedDeck(d.id)}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
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
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <Plus size={16} /> New deck
        </button>
      )}
    </div>
  )
}

/* ------------------------------ Grades sidebar ----------------------------- */

function GradesSidebar(): React.JSX.Element {
  const { notebooks, activeNotebookId, setActiveNotebook, gradingSystem } = useApp()
  const version = useVersion('grades')
  const [all, setAll] = useState<Grade[]>([])

  useEffect(() => {
    void api.grades.all().then(setAll)
  }, [version])

  const bySubject = notebooks
    .map((nb) => ({ nb, avg: subjectAverage(all.filter((g) => g.notebook_id === nb.id), gradingSystem) }))
    .filter((x): x is { nb: (typeof notebooks)[number]; avg: NonNullable<ReturnType<typeof subjectAverage>> } => x.avg !== null)

  // Overall: the mean of the subject averages, in whichever system is in use.
  const mean = bySubject.length > 0 ? bySubject.reduce((a, x) => a + x.avg.value, 0) / bySubject.length : null
  const overallLabel = gradingSystem === 'swiss' ? 'Ø Grade' : 'Average'
  const overallValue = mean === null ? null : gradingSystem === 'swiss' ? mean.toFixed(2) : `${mean.toFixed(1)}%`

  return (
    <div className="fade-up">
      <SectionLabel>Overall</SectionLabel>
      <div className="mb-2 rounded-lg bg-sunken px-3 py-2">
        {overallValue === null ? (
          <p className="text-xs text-faint">No grades yet. Add some in the main panel.</p>
        ) : (
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-faint">{overallLabel}</div>
              <div className="text-xl font-bold tabular-nums">{overallValue}</div>
            </div>
            <div className="text-xs text-muted">
              {bySubject.length} subject{bySubject.length === 1 ? '' : 's'}
            </div>
          </div>
        )}
      </div>
      <SectionLabel>By subject</SectionLabel>
      {bySubject.length === 0 && <p className="px-2 py-2 text-xs text-faint">Weighted averages show up here.</p>}
      {bySubject.map(({ nb, avg }) => (
        <button
          key={nb.id}
          type="button"
          onClick={() => setActiveNotebook(nb.id)}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
            activeNotebookId === nb.id ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink'
          }`}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ramp(nb.color)[500] }} />
          <span className="truncate">{nb.name}</span>
          <span className="ml-auto font-semibold tabular-nums" style={{ color: 'var(--accent-text)' }}>
            {avg.display}
          </span>
        </button>
      ))}
    </div>
  )
}

/* --------------------------------- Shared --------------------------------- */

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <div className={`px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-faint ${className}`}>{children}</div>
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
    bumpData('decks')
    bumpData('grades')
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
