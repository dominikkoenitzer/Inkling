import { useEffect, useState } from 'react'
import { Layers, TrendingUp, Timer, Flame, ArrowRight, Play, Plus, CheckSquare, FileText } from 'lucide-react'
import { format, isToday } from 'date-fns'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { useTimer } from '@/stores/timer'
import { subjectAverage } from '@shared/grades'
import { ramp, isColorKey, softTint } from '@/lib/colors'
import { hasGlyph, NotebookGlyph } from '@/lib/icons'
import { Inky } from '@/components/Inky'
import type { Deck, Task, Grade, Note, Notebook } from '@shared/types'

const api = window.inkling

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * The daily study plan — assembles "what should I do right now" from due flashcards,
 * open tasks, the weakest graded subject and today's focus time, each with a one-click
 * start. Solves the blank-page problem that keeps people from starting at all.
 */
export function TodayView(): React.JSX.Element {
  const app = useApp()
  const version = useVersion('decks') + useVersion('tasks') + useVersion('grades') + useVersion('focus')
  const [decks, setDecks] = useState<Deck[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [minutes, setMinutes] = useState(0)
  const [loaded, setLoaded] = useState(false)
  // tasks mid-completion: keeps the checkbox visibly ticked until the refetch removes the row
  const [completing, setCompleting] = useState<Set<number>>(new Set())
  const [recent, setRecent] = useState<Note[]>([])
  const notesVersion = useVersion('notes')

  useEffect(() => {
    // Overlapping fetches can resolve out of order; only the newest may write state.
    let stale = false
    void Promise.all([api.decks.list(), api.tasks.smart('today'), api.grades.all(), api.focus.todayMinutes()]).then(([d, t, g, m]) => {
      if (stale) return
      setDecks(d)
      setTasks(t)
      setGrades(g)
      setMinutes(m)
      setLoaded(true)
    })
    return () => {
      stale = true
    }
  }, [version])

  useEffect(() => {
    if (app.activeNotebookId === null) return
    void api.notes.list(app.activeNotebookId, 'page').then((pages) => {
      setRecent([...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 4))
    })
  }, [app.activeNotebookId, notesVersion])

  const nbOf = (id: number): Notebook | undefined => app.notebooks.find((n) => n.id === id)
  const active = nbOf(app.activeNotebookId ?? -1)
  const inkyColor = isColorKey(active?.color) ? active.color : 'teal'
  const dueDecks = decks.filter((d) => d.due_count > 0)
  const openTasks = tasks.filter((t) => t.status !== 'done')
  const bySubject = app.notebooks
    .map((nb) => ({ nb, avg: subjectAverage(grades.filter((g) => g.notebook_id === nb.id), app.gradingSystem) }))
    .filter((x): x is { nb: Notebook; avg: NonNullable<ReturnType<typeof subjectAverage>> } => x.avg !== null)
  const weakest = bySubject.length >= 2 ? bySubject.reduce((a, b) => (b.avg.value < a.avg.value ? b : a)) : null
  // gate on loaded so the focus card can't flash before the first fetch lands
  const suggestFocus = loaded && minutes === 0
  const planCount = dueDecks.length + openTasks.length + (weakest ? 1 : 0) + (suggestFocus ? 1 : 0)
  const cleared = loaded && planCount === 0

  const completeTask = (t: Task): void => {
    setCompleting((prev) => new Set(prev).add(t.id))
    void api.tasks.update(t.id, { status: 'done' }).then(() => {
      app.celebrate()
      bumpData('tasks')
      if (t.note_id !== null) bumpData('notes')
    })
  }

  const dueLabel = (t: Task): { text: string; overdue: boolean } => {
    if (!t.due_date) return { text: 'today', overdue: false }
    const due = new Date(t.due_date)
    if (!isToday(due) && due.getTime() < Date.now()) return { text: `overdue since ${format(due, 'EEE d MMM')}`, overdue: true }
    const hm = format(due, 'HH:mm')
    return { text: hm === '00:00' ? 'today' : `due ${hm}`, overdue: false }
  }

  const startFocus = (): void => {
    void useTimer.getState().start(25)
    app.setSelectedDeck(null)
    app.setTab('study')
  }

  const newPage = async (): Promise<void> => {
    if (app.activeNotebookId === null) return
    const note = await api.notes.create({ notebook_id: app.activeNotebookId, type: 'page' })
    bumpData('notes')
    app.openNote(app.activeNotebookId, note.id)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-6 pb-16 pt-10">
        <div className="fade-up mb-6 flex items-center gap-4">
          <Inky pose={cleared ? 'happy' : 'wave'} color={inkyColor} size={76} />
          <div>
            <h1 className="text-[28px] font-bold leading-tight">{greeting()}!</h1>
            <p className="text-sm text-muted">
              {format(new Date(), 'EEEE, MMMM d')}
              {app.streak.count > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 font-semibold text-ink">
                  <Flame size={14} className="flame" style={{ color: 'var(--accent-text)' }} /> {app.streak.count}-day streak
                </span>
              )}
            </p>
            <p className="mt-0.5 text-sm text-faint">
              {cleared
                ? 'Nothing queued. The day is yours.'
                : loaded
                  ? `${planCount} small win${planCount === 1 ? '' : 's'} queued for today.`
                  : 'Putting your plan together…'}
            </p>
          </div>
        </div>

        {cleared && (
          <>
            <div className="pop-in relative overflow-hidden rounded-lg bg-raised p-8 text-center" style={{ boxShadow: 'var(--shadow)' }}>
              <Confetti />
              <div className="text-lg font-bold">Plan cleared 🎉</div>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                No cards due, no tasks pending. Get ahead, or just enjoy it.
              </p>
            </div>
            <div className="stagger mt-3 grid grid-cols-3 gap-2">
              <QuickAction icon={<Plus size={18} />} label="New page" onClick={() => void newPage()} />
              <QuickAction
                icon={<Layers size={18} />}
                label="Build a deck"
                onClick={() => {
                  app.setSelectedDeck(null)
                  app.setTab('study')
                }}
              />
              <QuickAction icon={<CheckSquare size={18} />} label="Add a task" onClick={() => app.setTab('tasks')} />
            </div>
          </>
        )}

        {minutes > 0 && (
          <p className="fade-up mb-4 flex items-center gap-1.5 text-sm text-muted">
            <Timer size={16} style={{ color: 'var(--accent-text)' }} /> {minutes} focused minute{minutes === 1 ? '' : 's'} today already.
          </p>
        )}

        <div className="stagger space-y-2">
          {dueDecks.map((d) => {
            const nb = nbOf(d.notebook_id)
            return (
              <PlanCard
                key={`d${d.id}`}
                bubble={hasGlyph(nb?.icon) ? <NotebookGlyph icon={nb?.icon} size={18} /> : <Layers size={18} />}
                tint={softTint(nb?.color, app.theme)}
                title={`Review ${d.name}`}
                sub={`${d.due_count} card${d.due_count === 1 ? '' : 's'} due · ${nb?.name ?? 'notebook'}`}
                actionLabel="Review"
                onAction={() => app.openDeck(d.notebook_id, d.id)}
              />
            )
          })}

          {openTasks.map((t) => {
            const nb = nbOf(t.notebook_id)
            const due = dueLabel(t)
            return (
              <div
                key={`t${t.id}`}
                className="plan-card group flex cursor-pointer items-center gap-3 rounded-lg border border-edge bg-raised px-4 py-3"
                onClick={() => app.openTask(t.notebook_id, t.id)}
              >
                <input
                  type="checkbox"
                  checked={completing.has(t.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => completeTask(t)}
                  className="check-pop h-4 w-4 shrink-0 accent-[var(--accent)]"
                  title="Mark done"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="text-xs" style={due.overdue ? { color: '#e5484d' } : undefined}>
                    <span className={due.overdue ? 'font-semibold' : 'text-faint'}>{due.text}</span>
                    {nb ? <span className="text-faint"> · {nb.name}</span> : null}
                  </div>
                </div>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ramp(nb?.color)[500] }} />
              </div>
            )
          })}

          {weakest && (
            <PlanCard
              bubble={hasGlyph(weakest.nb.icon) ? <NotebookGlyph icon={weakest.nb.icon} size={18} /> : <TrendingUp size={18} />}
              tint={softTint(weakest.nb.color, app.theme)}
              title={`Give ${weakest.nb.name} some love`}
              sub={`Your lowest average right now (${weakest.avg.display})`}
              actionLabel="Open"
              onAction={() => {
                app.setActiveNotebook(weakest.nb.id)
                app.setTab('grades')
              }}
            />
          )}

          {suggestFocus && !cleared && (
            <PlanCard
              bubble={<Play size={18} />}
              tint={softTint(active?.color, app.theme)}
              title="One 25-minute focus block"
              sub="Start the timer, pick anything above. Momentum does the rest."
              actionLabel="Start"
              onAction={startFocus}
            />
          )}
        </div>

        {recent.length > 0 && (
          <div className="mt-8">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-faint">Jump back in</div>
            <div className="stagger space-y-0.5">
              {recent.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => app.openNote(n.notebook_id, n.id)}
                  className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-sm text-muted transition-colors hover:bg-hover hover:text-ink"
                >
                  <FileText size={16} className="shrink-0" />
                  <span className="truncate">{n.title || 'Untitled'}</span>
                  <span className="ml-auto shrink-0 text-xs text-faint">{format(new Date(n.updated_at), 'd MMM')}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PlanCard({
  bubble,
  tint,
  title,
  sub,
  actionLabel,
  onAction
}: {
  bubble: React.ReactNode
  tint: { bg: string; text: string }
  title: string
  sub: string
  actionLabel: string
  onAction: () => void
}): React.JSX.Element {
  return (
    <div className="plan-card group flex cursor-pointer items-center gap-3 rounded-lg border border-edge bg-raised px-4 py-3" onClick={onAction}>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
        style={{ background: tint.bg, color: tint.text }}
      >
        {bubble}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-faint">{sub}</div>
      </div>
      <span
        className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: 'var(--accent)' }}
      >
        {actionLabel} <ArrowRight size={12} />
      </span>
    </div>
  )
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="plan-card flex h-9 items-center justify-center gap-2 rounded-lg bg-raised px-3 text-xs font-medium text-muted hover:text-ink"
    >
      {icon}
      {label}
    </button>
  )
}

/** Pure-CSS confetti burst for the cleared state. */
function Confetti(): React.JSX.Element {
  const colors = ['#1D9E75', '#D85A30', '#BA7517', '#D4537E', '#3DB58B', '#E48CA8']
  return (
    <div className="confetti pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 14 }, (_, i) => (
        <span
          key={i}
          style={{
            left: `${6 + i * 6.5}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 7) * 0.12}s`,
            animationDuration: `${1.8 + (i % 5) * 0.3}s`
          }}
        />
      ))}
    </div>
  )
}
