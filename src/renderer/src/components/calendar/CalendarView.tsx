import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { expandEvents, type Occurrence } from '@/lib/recur'
import { ramp, isColorKey } from '@/lib/colors'
import { Segmented, Button } from '@/components/ui'
import { EventDialog, type EventDraft } from './EventDialog'
import type { Notebook, CalEvent, Task } from '@shared/types'

const api = window.inkling

const HOUR_START = 7
const HOUR_END = 22
const HOUR_PX = 48

export function CalendarView({ notebook }: { notebook: Notebook }): React.JSX.Element {
  const [view, setView] = useState<'week' | 'month'>('week')
  const [cursor, setCursor] = useState(() => new Date())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [draft, setDraft] = useState<EventDraft | null>(null)
  const version = useVersion('events') * 1000 + useVersion('tasks')

  const range = useMemo(() => {
    if (view === 'week') {
      const from = startOfWeek(cursor, { weekStartsOn: 1 })
      return { from, to: addDays(from, 7) }
    }
    const from = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    const to = addDays(endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }), 1)
    return { from, to }
  }, [view, cursor])

  useEffect(() => {
    void api.events.window(range.from.toISOString(), range.to.toISOString()).then(setEvents)
    void api.tasks.smart('week').then(() => undefined) // warm smart counts
    // all tasks with due dates in range (across notebooks appear on calendar per §3)
    void loadDueTasks(range.from, range.to).then(setTasks)
  }, [range, version])

  const occurrences = useMemo(() => expandEvents(events, range.from, range.to), [events, range])
  const days = useMemo(() => eachDayOfInterval({ start: range.from, end: addDays(range.to, -1) }), [range])

  const label = view === 'week' ? `${format(range.from, 'd MMM')} – ${format(addDays(range.to, -1), 'd MMM yyyy')}` : format(cursor, 'MMMM yyyy')

  const openNew = (start: Date): void => {
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    setDraft({ id: null, notebook_id: notebook.id, title: '', start, end, byday: [] })
  }
  const openEdit = (occ: Occurrence): void => {
    setDraft({
      id: occ.event.id,
      notebook_id: occ.event.notebook_id,
      title: occ.event.title,
      start: new Date(occ.event.start_time),
      end: occ.event.end_time ? new Date(occ.event.end_time) : new Date(new Date(occ.event.start_time).getTime() + 3600000),
      byday: occ.event.recurrence_rule?.match(/BYDAY=([A-Z,]+)/)?.[1].split(',') ?? []
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-5 py-2.5">
        <h2 className="text-[15px] font-bold">{label}</h2>
        <button type="button" onClick={() => setCursor(view === 'week' ? addWeeks(cursor, -1) : addMonths(cursor, -1))} className="rounded-md p-1 text-muted hover:bg-hover hover:text-ink" title="Previous">
          <ChevronLeft size={16} />
        </button>
        <button type="button" onClick={() => setCursor(new Date())} className="rounded-md px-2 py-0.5 text-xs font-medium text-muted hover:bg-hover hover:text-ink">
          Today
        </button>
        <button type="button" onClick={() => setCursor(view === 'week' ? addWeeks(cursor, 1) : addMonths(cursor, 1))} className="rounded-md p-1 text-muted hover:bg-hover hover:text-ink" title="Next">
          <ChevronRight size={16} />
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="primary" onClick={() => openNew(defaultStart(new Date()))}>
            <Plus size={14} /> Event
          </Button>
          <Segmented
            options={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' }
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </div>

      {view === 'week' ? (
        <WeekGrid days={days} occurrences={occurrences} tasks={tasks} onSlotClick={openNew} onEventClick={openEdit} />
      ) : (
        <MonthGrid cursor={cursor} days={days} occurrences={occurrences} tasks={tasks} onDayClick={(d) => openNew(defaultStart(d))} onEventClick={openEdit} />
      )}

      {draft && <EventDialog draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}

async function loadDueTasks(from: Date, to: Date): Promise<Task[]> {
  // pull due tasks via smart-week API is too narrow; reuse events window on tasks by listing all notebooks' tasks
  const notebooks = await api.notebooks.list()
  const all = await Promise.all(notebooks.map((n) => api.tasks.list(n.id)))
  return all.flat().filter((t) => t.due_date && new Date(t.due_date) >= from && new Date(t.due_date) < to)
}

function defaultStart(day: Date): Date {
  const d = new Date(day)
  const now = new Date()
  d.setHours(Math.min(Math.max(now.getHours() + 1, 9), 20), 0, 0, 0)
  return d
}

function eventColor(ev: CalEvent, notebooks: Notebook[]): { bg: string; text: string; bar: string } {
  const nb = notebooks.find((n) => n.id === ev.notebook_id)
  const key = isColorKey(ev.color) ? ev.color : isColorKey(nb?.color) ? nb!.color : 'teal'
  const r = ramp(key)
  return { bg: `color-mix(in srgb, ${r[500]} 26%, var(--bg-raised))`, text: 'var(--text-primary)', bar: r[500] }
}

/* -------------------------------- Week grid ------------------------------- */

interface DragState {
  kind: 'event' | 'task'
  id: number
  duration: number
  ghost: { day: number; minutes: number } | null
  title: string
  moved: boolean
}

function WeekGrid({
  days,
  occurrences,
  tasks,
  onSlotClick,
  onEventClick
}: {
  days: Date[]
  occurrences: Occurrence[]
  tasks: Task[]
  onSlotClick: (start: Date) => void
  onEventClick: (occ: Occurrence) => void
}): React.JSX.Element {
  const { notebooks, openTask } = useApp()
  const gridRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)

  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)

  const pointToSlot = (clientX: number, clientY: number): { day: number; minutes: number } | null => {
    const el = gridRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top + el.scrollTop
    const colW = (rect.width - 52) / 7
    const day = Math.max(0, Math.min(6, Math.floor((x - 52) / colW)))
    const rawMin = ((y - TASK_ROW_H) / HOUR_PX) * 60 + HOUR_START * 60
    const minutes = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - 30, Math.round(rawMin / 30) * 30))
    return { day, minutes }
  }

  const startDrag = (e: React.PointerEvent, kind: 'event' | 'task', id: number, duration: number, title: string): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const st: DragState = { kind, id, duration, ghost: null, title, moved: false }
    dragRef.current = st
    setDrag(st)
    const move = (ev: PointerEvent): void => {
      if (!dragRef.current) return
      const slot = pointToSlot(ev.clientX, ev.clientY)
      if (!slot) return
      // only count as a drag once the pointer clears a small threshold, so tiny jitter during a
      // click doesn't reschedule or swallow the click
      const moved = dragRef.current.moved || Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4
      dragRef.current = { ...dragRef.current, ghost: slot, moved }
      setDrag(dragRef.current)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const st2 = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!st2 || !st2.ghost || !st2.moved) return
      // a real drag just ended — swallow the synthetic click the browser dispatches next, which
      // would otherwise reopen the edit dialog, open a New-event slot, or jump to the Tasks tab
      suppressClickRef.current = true
      setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      const day = days[st2.ghost.day]
      const start = new Date(day)
      start.setHours(0, st2.ghost.minutes, 0, 0)
      if (st2.kind === 'event') {
        void api.events
          .update(st2.id, { start_time: start.toISOString(), end_time: new Date(start.getTime() + st2.duration).toISOString() })
          .then(() => bumpData('events'))
      } else {
        void api.tasks.update(st2.id, { due_date: start.toISOString() }).then(() => bumpData('tasks'))
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const TASK_ROW_H = 34

  return (
    <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto">
      {/* day headers + due-task chips */}
      <div className="sticky top-0 z-10 grid border-b border-edge bg-sunken" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
        <div />
        {days.map((d) => (
          <div key={d.toISOString()} className="border-l border-edge px-1.5 py-1">
            <div className={`text-center text-xs font-semibold ${isToday(d) ? '' : 'text-muted'}`} style={isToday(d) ? { color: 'var(--accent-text)' } : undefined}>
              {format(d, 'EEE d')}
            </div>
            <div className="flex min-h-[18px] flex-wrap gap-0.5 pb-0.5">
              {tasks
                .filter((t) => t.due_date && isSameDay(new Date(t.due_date), d))
                .slice(0, 3)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={`${t.title} — drag to reschedule, click to open`}
                    onPointerDown={(e) => startDrag(e, 'task', t.id, 0, t.title)}
                    onClick={() => {
                      if (suppressClickRef.current) return
                      openTask(t.notebook_id, t.id)
                    }}
                    className={`max-w-full cursor-grab truncate rounded px-1 text-[10px] font-medium text-white ${t.status === 'done' ? 'opacity-40 line-through' : ''}`}
                    style={{ background: ramp(notebooks.find((n) => n.id === t.notebook_id)?.color)[500] }}
                  >
                    {t.title}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* hour grid */}
      <div className="relative grid" style={{ gridTemplateColumns: '52px repeat(7, 1fr)', height: hours.length * HOUR_PX }}>
        <div className="relative">
          {hours.map((h, i) => (
            <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-faint" style={{ top: i * HOUR_PX }}>
              {i > 0 && `${String(h).padStart(2, '0')}:00`}
            </div>
          ))}
        </div>
        {days.map((d, di) => (
          <div
            key={d.toISOString()}
            className={`relative border-l border-edge ${isToday(d) ? 'bg-hover/40' : ''}`}
            onClick={(e) => {
              if (suppressClickRef.current) return // just finished a drag in this column
              const slot = pointToSlot(e.clientX, e.clientY)
              if (!slot) return
              const start = new Date(d)
              start.setHours(0, slot.minutes, 0, 0)
              onSlotClick(start)
            }}
          >
            {hours.map((h, i) => (
              <div key={h} className="absolute inset-x-0 border-t border-edge/60" style={{ top: i * HOUR_PX, borderColor: 'var(--border)' }} />
            ))}
            {occurrences
              .filter((o) => isSameDay(o.start, d))
              .map((o) => {
                const startMin = o.start.getHours() * 60 + o.start.getMinutes()
                const endMin = o.end.getHours() * 60 + o.end.getMinutes() || 24 * 60
                const top = ((startMin - HOUR_START * 60) / 60) * HOUR_PX
                const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_PX - 2)
                const colors = eventColor(o.event, notebooks)
                const recurring = !!o.event.recurrence_rule
                const beingDragged = drag?.kind === 'event' && drag.id === o.event.id && drag.moved
                return (
                  <div
                    key={o.key}
                    className={`absolute inset-x-0.5 cursor-pointer overflow-hidden rounded-md px-1.5 py-0.5 text-[11px] leading-tight ${beingDragged ? 'opacity-30' : ''}`}
                    style={{ top, height, background: colors.bg, borderLeft: `3px solid ${colors.bar}` }}
                    title={recurring ? `${o.event.title} (repeats weekly — click to edit series)` : `${o.event.title} — drag to reschedule`}
                    onPointerDown={(e) => {
                      if (!recurring) startDrag(e, 'event', o.event.id, o.end.getTime() - o.start.getTime(), o.event.title)
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (suppressClickRef.current) return
                      onEventClick(o)
                    }}
                  >
                    <span className="font-semibold" style={{ color: colors.text }}>
                      {o.event.title}
                    </span>
                    <span className="ml-1 text-faint">{format(o.start, 'HH:mm')}</span>
                    {recurring && <Repeat size={9} className="ml-1 inline text-faint" />}
                  </div>
                )
              })}
            {/* drag ghost */}
            {drag?.ghost && drag.ghost.day === di && drag.moved && (
              <div
                className="pointer-events-none absolute inset-x-0.5 rounded-md border-2 border-dashed px-1.5 text-[11px]"
                style={{
                  top: ((drag.ghost.minutes - HOUR_START * 60) / 60) * HOUR_PX,
                  height: drag.kind === 'event' ? Math.max(20, (drag.duration / 3600000) * HOUR_PX) : 22,
                  borderColor: 'var(--accent)',
                  background: 'var(--accent-soft)'
                }}
              >
                {drag.title}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------- Month grid ------------------------------- */

function MonthGrid({
  cursor,
  days,
  occurrences,
  tasks,
  onDayClick,
  onEventClick
}: {
  cursor: Date
  days: Date[]
  occurrences: Occurrence[]
  tasks: Task[]
  onDayClick: (d: Date) => void
  onEventClick: (occ: Occurrence) => void
}): React.JSX.Element {
  const { notebooks, openTask } = useApp()
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr]">
      <div className="grid grid-cols-7 border-b border-edge">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="px-2 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-faint">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-0" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid min-h-0 grid-cols-7 border-b border-edge last:border-b-0">
            {week.map((d) => {
              const dayOcc = occurrences.filter((o) => isSameDay(o.start, d))
              const dayTasks = tasks.filter((t) => t.due_date && isSameDay(new Date(t.due_date), d))
              // events and tasks are capped independently (3 + 2), so count hidden per-list
              const hidden = Math.max(0, dayOcc.length - 3) + Math.max(0, dayTasks.length - 2)
              const faded = !isSameMonth(d, cursor)
              return (
                <div
                  key={d.toISOString()}
                  className={`group min-h-0 cursor-pointer overflow-hidden border-l border-edge p-1 first:border-l-0 hover:bg-hover ${faded ? 'opacity-45' : ''}`}
                  onClick={() => onDayClick(startOfDay(d))}
                >
                  <div
                    className={`mb-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${isToday(d) ? 'text-white' : 'text-muted'}`}
                    style={isToday(d) ? { background: 'var(--accent)' } : undefined}
                  >
                    {format(d, 'd')}
                  </div>
                  {dayOcc.slice(0, 3).map((o) => {
                    const colors = eventColor(o.event, notebooks)
                    return (
                      <button
                        key={o.key}
                        type="button"
                        className="mb-0.5 block w-full truncate rounded px-1 text-left text-[10.5px] font-medium"
                        style={{ background: colors.bg, borderLeft: `2px solid ${colors.bar}` }}
                        onClick={(e) => {
                          e.stopPropagation()
                          onEventClick(o)
                        }}
                      >
                        {format(o.start, 'HH:mm')} {o.event.title}
                      </button>
                    )
                  })}
                  {dayTasks.slice(0, 2).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`mb-0.5 block w-full truncate rounded px-1 text-left text-[10.5px] font-medium text-white ${t.status === 'done' ? 'opacity-40 line-through' : ''}`}
                      style={{ background: ramp(notebooks.find((n) => n.id === t.notebook_id)?.color)[500] }}
                      onClick={(e) => {
                        e.stopPropagation()
                        openTask(t.notebook_id, t.id)
                      }}
                    >
                      ☐ {t.title}
                    </button>
                  ))}
                  {hidden > 0 && <div className="px-1 text-[10px] text-faint">+{hidden} more</div>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
