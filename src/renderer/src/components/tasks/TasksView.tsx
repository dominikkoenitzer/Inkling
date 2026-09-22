import { useEffect, useState } from 'react'
import { Trash2, Plus, CalendarClock, FileText } from 'lucide-react'
import { format, isBefore, isToday, startOfDay } from 'date-fns'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { isColorKey } from '@/lib/colors'
import { EmptyState } from '@/components/Inky'
import type { Notebook, Task } from '@shared/types'

const api = window.inkling

export function TasksView({ notebook }: { notebook: Notebook }): React.JSX.Element {
  const version = useVersion('tasks')
  const [tasks, setTasks] = useState<Task[]>([])
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    void api.tasks.list(notebook.id).then(setTasks)
  }, [notebook.id, version])

  const addTask = async (): Promise<void> => {
    if (!newTitle.trim()) return
    await api.tasks.create({ notebook_id: notebook.id, title: newTitle.trim() })
    setNewTitle('')
    bumpData('tasks')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge px-5 py-2.5">
        <h2 className="text-base font-bold">Tasks · {notebook.name}</h2>
      </div>

      <div className="border-b border-edge px-5 py-2">
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-lg bg-raised px-3 py-1.5">
          <Plus size={16} className="text-faint" />
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addTask()}
            placeholder="Add a task, press Enter…"
            className="flex-1 bg-transparent text-sm placeholder:text-faint"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-3">
        {tasks.length === 0 ? (
          <EmptyState
            pose="sleepy"
            color={isColorKey(notebook.color) ? notebook.color : 'teal'}
            title="No tasks here yet"
            hint="Add one above, or type [] inside any note. It lands here automatically."
          />
        ) : (
          <ListView tasks={tasks} />
        )}
      </div>
    </div>
  )
}

/* -------------------------------- List view ------------------------------- */

function ListView({ tasks }: { tasks: Task[] }): React.JSX.Element {
  const today = startOfDay(new Date())
  const groups: Array<{ label: string; items: Task[] }> = [
    { label: 'Overdue', items: [] },
    { label: 'Today', items: [] },
    { label: 'Upcoming', items: [] },
    { label: 'Someday', items: [] },
    { label: 'Done', items: [] }
  ]
  for (const t of tasks) {
    if (t.status === 'done') groups[4].items.push(t)
    else if (!t.due_date) groups[3].items.push(t)
    else if (isBefore(new Date(t.due_date), today)) groups[0].items.push(t)
    else if (isToday(new Date(t.due_date))) groups[1].items.push(t)
    else groups[2].items.push(t)
  }

  // Only done tasks left: show an explicit empty "To do" group so the list doesn't
  // read as broken with a lone crossed-out section.
  const onlyDone = tasks.length > 0 && tasks.every((t) => t.status === 'done')

  return (
    <div className="mx-auto max-w-2xl">
      {onlyDone && (
        <div className="mb-4">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-faint">To do</div>
          <p className="px-1 py-1 text-sm text-faint">All clear. Add the next one above.</p>
        </div>
      )}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.label} className="mb-4">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-faint">{g.label}</div>
            {g.items.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </div>
        ))}
    </div>
  )
}

export function TaskRow({ task }: { task: Task }): React.JSX.Element {
  const { selectedTaskId, setSelectedTask, celebrate } = useApp()
  const done = task.status === 'done'
  const overdue = !done && task.due_date && isBefore(new Date(task.due_date), startOfDay(new Date()))

  const toggle = async (): Promise<void> => {
    await api.tasks.update(task.id, { status: done ? 'todo' : 'done' })
    if (!done) celebrate()
    bumpData('tasks')
    if (task.note_id !== null) bumpData('notes')
  }

  return (
    <div
      className={`group flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
        selectedTaskId === task.id ? 'bg-active' : 'hover:bg-hover'
      }`}
      onClick={() => setSelectedTask(task.id)}
    >
      <button
        type="button"
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        onClick={(e) => {
          e.stopPropagation()
          void toggle()
        }}
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-2 transition-colors"
        style={{ borderColor: done ? 'var(--accent)' : 'var(--text-faint)', background: done ? 'var(--accent)' : 'transparent' }}
      >
        {done && (
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
            <path d="M1.5 5.5 L4 8 L8.5 2.5" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </svg>
        )}
      </button>

      <span className={`min-w-0 flex-1 truncate text-sm ${done ? 'text-faint line-through' : ''}`}>{task.title}</span>

      {task.note_id !== null && <FileText size={14} className="shrink-0 text-faint" aria-label="Linked to a note" />}
      {task.due_date && (
        <span className={`flex shrink-0 items-center gap-1 text-[11px] ${overdue ? 'font-semibold text-red-400' : 'text-muted'}`}>
          <CalendarClock size={12} />
          {format(new Date(task.due_date), 'EEE d MMM')}
        </span>
      )}
      <button
        type="button"
        title="Delete task"
        onClick={(e) => {
          e.stopPropagation()
          if (selectedTaskId === task.id) setSelectedTask(null)
          void api.tasks.remove(task.id).then(() => {
            bumpData('tasks')
            if (task.note_id !== null) bumpData('notes')
          })
        }}
        className="hidden shrink-0 text-faint hover:text-red-400 group-hover:block"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
