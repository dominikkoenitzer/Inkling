import { useEffect, useState } from 'react'
import { PanelRightClose, PanelRightOpen, FileText, Flame, Timer, CalendarClock, Layers, Plus } from 'lucide-react'
import { format } from 'date-fns'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { ramp } from '@/lib/colors'
import { inputCls } from '@/components/ui'
import type { Task, Priority } from '@shared/types'

const api = window.inkling

export function RightPanel(): React.JSX.Element | null {
  const { tab, selectedNoteId, selectedTaskId, notesView } = useApp()
  const [open, setOpen] = useState(true)

  if (!open) {
    return (
      <button
        type="button"
        title="Open context panel"
        onClick={() => setOpen(true)}
        className="flex w-7 shrink-0 items-start justify-center border-l border-edge pt-3 text-faint hover:text-ink"
      >
        <PanelRightOpen size={16} />
      </button>
    )
  }

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-l border-edge bg-panel">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-faint">Context</span>
        <button type="button" title="Collapse panel" onClick={() => setOpen(false)} className="text-faint hover:text-ink">
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {tab === 'notes' && notesView === 'pages' && selectedNoteId !== null ? (
          <NoteContext noteId={selectedNoteId} />
        ) : tab === 'tasks' && selectedTaskId !== null ? (
          <TaskContext taskId={selectedTaskId} />
        ) : (
          <UpcomingContext />
        )}
      </div>
    </aside>
  )
}

/* ------------------------- Linked tasks for a note ------------------------- */

function NoteContext({ noteId }: { noteId: number }): React.JSX.Element {
  const version = useVersion('tasks')
  const [tasks, setTasks] = useState<Task[]>([])

  useEffect(() => {
    void api.tasks.forNote(noteId).then(setTasks)
  }, [noteId, version])

  return (
    <div className="fade-up">
      <PanelHeading icon={<FileText size={14} />}>Tasks in this note</PanelHeading>
      {tasks.length === 0 ? (
        <p className="text-xs text-faint">Type “[] ” in the note to create a linked task. It’ll show up here and in the Tasks tab.</p>
      ) : (
        tasks.map((t) => (
          <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1.5 text-sm hover:bg-hover">
            <input
              type="checkbox"
              checked={t.status === 'done'}
              onChange={() => {
                void api.tasks.update(t.id, { status: t.status === 'done' ? 'todo' : 'done' }).then(() => {
                  if (t.status !== 'done') useApp.getState().celebrate()
                  bumpData('tasks')
                  bumpData('notes')
                })
              }}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span className={t.status === 'done' ? 'text-faint line-through' : ''}>{t.title}</span>
          </label>
        ))
      )}
    </div>
  )
}

/* ----------------------------- Selected task ------------------------------ */

function TaskContext({ taskId }: { taskId: number }): React.JSX.Element {
  const version = useVersion('tasks')
  const { notebooks } = useApp()
  const [task, setTask] = useState<Task | null>(null)
  const [subs, setSubs] = useState<Task[]>([])
  const [newSub, setNewSub] = useState('')
  const [title, setTitle] = useState('')

  useEffect(() => {
    void api.tasks.get(taskId).then((t) => {
      setTask(t)
      setTitle(t?.title ?? '')
      // Fetch subtasks from THIS task's notebook (not the previously-selected task's), so switching
      // between tasks in different notebooks doesn't flash an empty/wrong subtask list.
      if (t) void api.tasks.list(t.notebook_id).then((all) => setSubs(all.filter((s) => s.parent_task_id === taskId)))
      else setSubs([])
    })
  }, [taskId, version])

  if (!task) return <p className="text-xs text-faint">Select a task to see its details.</p>

  const patch = (p: Record<string, unknown>): void => {
    void api.tasks.update(taskId, p).then(() => bumpData('tasks'))
  }

  return (
    <div className="fade-up space-y-3">
      <textarea
        value={title}
        rows={2}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== task.title && patch({ title: title.trim() })}
        className="w-full resize-none rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold hover:border-edge focus:border-edge"
      />

      <PanelField label="Due">
        <input
          type="datetime-local"
          className={inputCls}
          value={task.due_date ? format(new Date(task.due_date), "yyyy-MM-dd'T'HH:mm") : ''}
          onChange={(e) => patch({ due_date: e.target.value ? new Date(e.target.value).toISOString() : null })}
        />
      </PanelField>

      <PanelField label="Priority">
        <div className="flex gap-1">
          {(['low', 'medium', 'high'] as Priority[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => patch({ priority: p })}
              className={`flex-1 rounded-lg border py-1 text-xs font-medium capitalize ${
                task.priority === p ? 'border-transparent text-white' : 'border-edge text-muted'
              }`}
              style={task.priority === p ? { background: 'var(--accent)' } : undefined}
            >
              {p}
            </button>
          ))}
        </div>
      </PanelField>

      <PanelField label="Status">
        <div className="flex gap-1">
          {(
            [
              ['todo', 'To do'],
              ['in_progress', 'Doing'],
              ['done', 'Done']
            ] as const
          ).map(([s, label]) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                if (s === 'done' && task.status !== 'done') useApp.getState().celebrate()
                patch({ status: s })
                if (task.note_id !== null) bumpData('notes')
              }}
              className={`flex-1 rounded-lg border py-1 text-xs font-medium ${task.status === s ? 'border-transparent text-white' : 'border-edge text-muted'}`}
              style={task.status === s ? { background: 'var(--accent)' } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </PanelField>

      {task.note_id !== null && (
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--accent-text)' }}
          onClick={() => useApp.getState().openNote(task.notebook_id, task.note_id!)}
        >
          <FileText size={14} /> Open linked note
        </button>
      )}

      <PanelField label="Subtasks">
        {subs.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              checked={s.status === 'done'}
              onChange={() => {
                void api.tasks.update(s.id, { status: s.status === 'done' ? 'todo' : 'done' }).then(() => bumpData('tasks'))
              }}
              className="accent-[var(--accent)]"
            />
            <span className={s.status === 'done' ? 'text-faint line-through' : ''}>{s.title}</span>
          </label>
        ))}
        <div className="flex items-center gap-1.5">
          <Plus size={14} className="text-faint" />
          <input
            className="flex-1 bg-transparent py-1 text-sm placeholder:text-faint"
            placeholder="Add subtask…"
            value={newSub}
            onChange={(e) => setNewSub(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSub.trim()) {
                void api.tasks
                  .create({ notebook_id: task.notebook_id, title: newSub.trim(), parent_task_id: taskId })
                  .then(() => bumpData('tasks'))
                setNewSub('')
              }
            }}
          />
        </div>
      </PanelField>

      <p className="text-xs text-faint">
        In {notebooks.find((n) => n.id === task.notebook_id)?.name ?? 'notebook'} · created {format(new Date(task.created_at), 'd MMM yyyy')}
      </p>
    </div>
  )
}

/* --------------------------- Upcoming (default) --------------------------- */

function UpcomingContext(): React.JSX.Element {
  const { notebooks, streak, openTask, setTab } = useApp()
  const version = useVersion('tasks') + useVersion('focus') + useVersion('decks')
  const [due, setDue] = useState<Task[]>([])
  const [minutes, setMinutes] = useState(0)
  const [dueCards, setDueCards] = useState(0)

  useEffect(() => {
    void Promise.all([api.tasks.smart('week'), api.focus.todayMinutes(), api.decks.list()]).then(([tasks, mins, decks]) => {
      setMinutes(mins)
      setDueCards(decks.reduce((a, d) => a + d.due_count, 0))
      setDue(tasks.slice(0, 8))
    })
    // colors come from the store at render time; notebook identity changes don't need a refetch
  }, [version])

  return (
    <div className="fade-up space-y-2.5">
      <div className="rounded-xl bg-sunken p-3">
        <PanelHeading icon={<CalendarClock size={14} />}>Due soon</PanelHeading>
        {due.length === 0 ? (
          <p className="text-xs text-faint">Nothing due this week. Enjoy the calm.</p>
        ) : (
          due.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openTask(t.notebook_id, t.id)}
              className="mb-1 flex w-full items-start gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-hover"
            >
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ background: ramp(notebooks.find((n) => n.id === t.notebook_id)?.color)[500] }}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm">{t.title}</span>
                <span className="block text-xs text-faint">{t.due_date ? `due ${format(new Date(t.due_date), 'EEE d MMM')}` : ''}</span>
              </span>
            </button>
          ))
        )}
      </div>
      <div className="rounded-xl bg-sunken p-3">
        <PanelHeading icon={<Layers size={14} />}>Cards to review</PanelHeading>
        {dueCards > 0 ? (
          <button type="button" className="text-sm font-medium" style={{ color: 'var(--accent-text)' }} onClick={() => setTab('today')}>
            {dueCards} card{dueCards === 1 ? '' : 's'} ready. See your plan →
          </button>
        ) : (
          <p className="text-sm">All caught up. 🃏</p>
        )}
      </div>
      <div className="rounded-xl bg-sunken p-3">
        <PanelHeading icon={<Timer size={14} />}>Focus today</PanelHeading>
        <p className="text-sm">{minutes > 0 ? `${minutes} focused minutes. Keep it up.` : 'No focus sessions yet today.'}</p>
      </div>
      <div className="rounded-xl bg-sunken p-3">
        <PanelHeading icon={<Flame size={14} />}>Streak</PanelHeading>
        <p className="text-sm">
          {streak.count > 0 ? `${streak.count} day${streak.count === 1 ? '' : 's'} of showing up. Quietly impressive.` : 'Review cards or finish a focus session to start one.'}
        </p>
      </div>
    </div>
  )
}

function PanelHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-faint">
      {icon}
      {children}
    </div>
  )
}

function PanelField({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-faint">{label}</div>
      {children}
    </div>
  )
}
