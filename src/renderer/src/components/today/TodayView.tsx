import { useEffect, useState } from 'react'
import { Layers, Plus } from 'lucide-react'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { localDay } from '@shared/day'
import { Inky } from '@/components/Inky'
import { Button, Code } from '@/components/ui'
import type { Deck, OpenTask } from '@shared/types'

const api = window.inkling

const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/** What is open across all notes, and which decks have cards due. */
export function TodayView(): React.JSX.Element {
  const today = useApp((s) => s.today)
  const version = useVersion('tasks') + useVersion('notes') + useVersion('decks')
  const [tasks, setTasks] = useState<OpenTask[]>([])
  const [decks, setDecks] = useState<Deck[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  // Ticked rows stay on screen, struck through, until the next visit.
  const [ticked, setTicked] = useState<Set<number>>(new Set())

  useEffect(() => {
    let stale = false
    Promise.all([api.tasks.open(), api.decks.list()]).then(
      ([t, d]) => {
        if (stale) return
        // Rows keep their place while you work through the list: known rows update in
        // place, ticked ones stay, new ones join at the end.
        setTasks((prev) => {
          const fresh = new Map(t.map((x) => [x.id, x]))
          const kept = prev.filter((p) => fresh.has(p.id) || ticked.has(p.id)).map((p) => fresh.get(p.id) ?? p)
          const known = new Set(kept.map((p) => p.id))
          return [...kept, ...t.filter((x) => !known.has(x.id))]
        })
        setDecks(d.filter((x) => x.due_count > 0))
        setLoaded(true)
        setFailed(false)
      },
      () => !stale && setFailed(true)
    )
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, today])

  const toggle = (t: OpenTask): void => {
    const done = !ticked.has(t.id)
    setTicked((prev) => {
      const next = new Set(prev)
      if (done) next.add(t.id)
      else next.delete(t.id)
      return next
    })
    api.tasks.setDone(t.id, done).then(
      () => bumpData('notes'),
      () =>
        setTicked((prev) => {
          const next = new Set(prev)
          if (done) next.delete(t.id)
          else next.add(t.id)
          return next
        })
    )
  }

  const empty = loaded && tasks.length === 0 && decks.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[680px] px-10 pb-20 pt-14">
        <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">Today</h1>
        <p className="mt-1 text-sm text-muted">{longDate.format(new Date())}</p>

        {failed && <p className="mt-16 text-sm text-muted">Today could not be loaded. It tries again as soon as anything changes.</p>}

        {empty && !failed && (
          <div className="mt-16 flex flex-col items-center text-center">
            <Inky size={44} className="mb-4" />
            <p className="text-[15px] text-ink">Nothing open. Enjoy the calm.</p>
            <p className="mt-1 text-sm text-muted">
              Start a line in a note with <Code>[ ]</Code> to make a to-do. It shows up here.
            </p>
            <Button variant="default" className="mt-5" onClick={() => void useApp.getState().newNote()}>
              <Plus size={15} /> New note
            </Button>
          </div>
        )}

        {tasks.length > 0 && (
          <Section title="To-do" count={tasks.length - ticked.size}>
            {tasks.map((t) => {
              const done = ticked.has(t.id)
              const due = t.due_date ? new Date(t.due_date) : null
              const overdue = !!due && !done && localDay(due) < today
              return (
                <li key={t.id} className="flex items-center gap-3 border-b border-edge py-2.5">
                  <input
                    type="checkbox"
                    className="check"
                    checked={done}
                    onChange={() => toggle(t)}
                    aria-label={done ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
                  />
                  <span className={`min-w-0 flex-1 truncate text-[15px] ${done ? 'text-faint line-through' : ''}`}>{t.title}</span>
                  {due && <span className={`shrink-0 text-xs ${overdue ? 'text-danger' : 'text-faint'}`}>{shortDate.format(due)}</span>}
                  {t.note_id !== null && (
                    <button
                      type="button"
                      onClick={() => useApp.getState().openNote(t.note_id!)}
                      className="max-w-[40%] shrink-0 truncate rounded px-1.5 py-0.5 text-xs text-faint transition-colors hover:bg-hover hover:text-muted"
                    >
                      {t.note_title?.trim() || 'Untitled'}
                    </button>
                  )}
                </li>
              )
            })}
          </Section>
        )}

        {decks.length > 0 && (
          <Section title="Study" count={decks.reduce((n, d) => n + d.due_count, 0)}>
            {decks.map((d) => (
              <li key={d.id} className="flex items-center gap-3 border-b border-edge py-2.5">
                <Layers size={16} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate text-[15px]">{d.name}</span>
                <span className="shrink-0 text-xs text-faint">
                  {d.due_count} card{d.due_count === 1 ? '' : 's'} due
                </span>
                <button type="button" onClick={() => useApp.getState().reviewDeck(d.id)} className="shrink-0 rounded-md px-2.5 py-1 text-sm font-medium text-accent-text transition-colors hover:bg-accent-soft">
                  Review
                </button>
              </li>
            ))}
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mt-10">
      <h2 className="mb-1 flex items-baseline gap-2 border-b border-edge pb-2 text-sm font-medium text-muted">
        {title}
        {count > 0 && <span className="text-xs tabular-nums text-faint">{count}</span>}
      </h2>
      <ul>{children}</ul>
    </section>
  )
}
