import { useEffect, useState } from 'react'
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Flag, Trash2, Plus, CalendarClock, FileText, ChevronRight } from 'lucide-react'
import { format, isBefore, isToday, startOfDay } from 'date-fns'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { isColorKey, ramp } from '@/lib/colors'
import { EmptyState } from '@/components/Inky'
import { Segmented } from '@/components/ui'
import type { Notebook, Task, TaskStatus, Priority } from '@shared/types'

const api = window.inkling

const PRIORITY_COLOR: Record<Priority, string> = { low: '#8a8f98', medium: '#c98b32', high: '#d85a30' }
const NEXT_PRIORITY: Record<Priority, Priority> = { low: 'medium', medium: 'high', high: 'low' }

export function TasksView({ notebook }: { notebook: Notebook }): React.JSX.Element {
  const { smartView } = useApp()
  const version = useVersion('tasks')
  const [tasks, setTasks] = useState<Task[]>([])
  const [mode, setMode] = useState<'list' | 'kanban'>('list')
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    const fetch = smartView ? api.tasks.smart(smartView) : api.tasks.list(notebook.id)
    void fetch.then(setTasks)
  }, [notebook.id, smartView, version])

  const addTask = async (): Promise<void> => {
    if (!newTitle.trim()) return
    let due: string | null = null
    if (smartView) {
      const d = new Date()
      d.setHours(17, 0, 0, 0)
      if (smartView === 'week') d.setDate(d.getDate() + 1)
      due = d.toISOString()
    }
    await api.tasks.create({ notebook_id: notebook.id, title: newTitle.trim(), due_date: due })
    setNewTitle('')
    bumpData('tasks')
  }

  const heading = smartView === 'today' ? 'Today' : smartView === 'week' ? 'This Week' : `Tasks · ${notebook.name}`

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge px-5 py-2.5">
        <h2 className="text-base font-bold">{heading}</h2>
        <div className="ml-auto">
          <Segmented
            options={[
              { value: 'list', label: 'List' },
              { value: 'kanban', label: 'Board' }
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      </div>

      <div className="border-b border-edge px-5 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-edge bg-panel px-3 py-1.5">
          <Plus size={16} className="text-faint" />
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addTask()}
            placeholder={smartView ? 'Add a task due soon…' : 'Add a task, press Enter…'}
            className="flex-1 bg-transparent text-sm placeholder:text-faint"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-3">
        {tasks.length === 0 ? (
          <EmptyState
            pose="sleepy"
            color={isColorKey(notebook.color) ? notebook.color : 'teal'}
            title={smartView ? 'Nothing due. Nice!' : 'No tasks here yet'}
            hint={smartView ? 'Take the win. Or get ahead of next week, your call.' : 'Add one above, or type [] inside any note. It lands here automatically.'}
          />
        ) : mode === 'list' ? (
          <ListView tasks={tasks} showNotebook={!!smartView} />
        ) : (
          <KanbanView tasks={tasks.filter((t) => t.parent_task_id === null || !tasks.some((p) => p.id === t.parent_task_id))} />
        )}
      </div>
    </div>
  )
}

/* -------------------------------- List view ------------------------------- */

function ListView({ tasks, showNotebook }: { tasks: Task[]; showNotebook: boolean }): React.JSX.Element {
  // A subtask whose parent isn't in this list (common in Today/This Week smart views, where the
  // parent may lack a due date or be done) is promoted to a root so it never silently disappears.
  const presentIds = new Set(tasks.map((t) => t.id))
  const roots = tasks.filter((t) => t.parent_task_id === null || !presentIds.has(t.parent_task_id))
  const childrenOf = (id: number): Task[] => tasks.filter((t) => t.parent_task_id === id)

  const today = startOfDay(new Date())
  const groups: Array<{ label: string; items: Task[] }> = [
    { label: 'Overdue', items: [] },
    { label: 'Today', items: [] },
    { label: 'Upcoming', items: [] },
    { label: 'Someday', items: [] },
    { label: 'Done', items: [] }
  ]
  for (const t of roots) {
    if (t.status === 'done') groups[4].items.push(t)
    else if (!t.due_date) groups[3].items.push(t)
    else if (isBefore(new Date(t.due_date), today)) groups[0].items.push(t)
    else if (isToday(new Date(t.due_date))) groups[1].items.push(t)
    else groups[2].items.push(t)
  }

  return (
    <div className="mx-auto max-w-2xl">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.label} className="mb-4">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-faint">{g.label}</div>
            {g.items.map((t) => (
              <div key={t.id}>
                <TaskRow task={t} showNotebook={showNotebook} />
                {childrenOf(t.id).map((c) => (
                  <div key={c.id} className="ml-7">
                    <TaskRow task={c} showNotebook={false} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}

export function TaskRow({ task, showNotebook }: { task: Task; showNotebook: boolean }): React.JSX.Element {
  const { notebooks, selectedTaskId, setSelectedTask, celebrate } = useApp()
  const nb = notebooks.find((n) => n.id === task.notebook_id)
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
      {task.status === 'in_progress' && (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
          in progress
        </span>
      )}
      {showNotebook && nb && (
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: ramp(nb.color)[500] }}>
          {nb.name}
        </span>
      )}
      {task.due_date && (
        <span className={`flex shrink-0 items-center gap-1 text-[11px] ${overdue ? 'font-semibold text-red-400' : 'text-muted'}`}>
          <CalendarClock size={12} />
          {format(new Date(task.due_date), 'EEE d MMM')}
        </span>
      )}
      <button
        type="button"
        title={`Priority: ${task.priority} (click to change)`}
        onClick={(e) => {
          e.stopPropagation()
          void api.tasks.update(task.id, { priority: NEXT_PRIORITY[task.priority] }).then(() => bumpData('tasks'))
        }}
        className="shrink-0 opacity-60 hover:opacity-100"
      >
        <Flag size={14} fill={task.priority === 'high' ? PRIORITY_COLOR.high : 'none'} style={{ color: PRIORITY_COLOR[task.priority] }} />
      </button>
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

/* ------------------------------- Kanban view ------------------------------ */

const COLUMNS: Array<{ id: TaskStatus; label: string }> = [
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'done', label: 'Done' }
]

function KanbanView({ tasks }: { tasks: Task[] }): React.JSX.Element {
  const { celebrate } = useApp()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const onDragEnd = (e: DragEndEvent): void => {
    const taskId = Number(e.active.id)
    const status = e.over?.id as TaskStatus | undefined
    if (!status) return
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === status) return
    if (status === 'done') celebrate()
    void api.tasks.update(taskId, { status }).then(() => {
      bumpData('tasks')
      if (task.note_id !== null) bumpData('notes')
    })
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid h-full grid-cols-3 gap-3">
        {COLUMNS.map((col) => (
          <KanbanColumn key={col.id} column={col} tasks={tasks.filter((t) => t.status === col.id)} />
        ))}
      </div>
    </DndContext>
  )
}

function KanbanColumn({ column, tasks }: { column: { id: TaskStatus; label: string }; tasks: Task[] }): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[200px] flex-col rounded-xl border p-2 transition-colors ${isOver ? 'border-transparent' : 'border-edge'}`}
      style={{ background: isOver ? 'var(--accent-soft)' : 'var(--bg-panel)' }}
    >
      <div className="flex items-center gap-2 px-1.5 pb-2 pt-1 text-xs font-bold uppercase tracking-wider text-muted">
        {column.label}
        <span className="rounded-full bg-raised px-1.5 text-[11px]">{tasks.length}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {tasks.map((t) => (
          <KanbanCard key={t.id} task={t} />
        ))}
      </div>
    </div>
  )
}

function KanbanCard({ task }: { task: Task }): React.JSX.Element {
  const { setSelectedTask, selectedTaskId } = useApp()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.6 : 1 }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => setSelectedTask(task.id)}
      className={`cursor-grab rounded-lg border border-edge bg-raised p-2.5 text-sm shadow-sm active:cursor-grabbing ${
        selectedTaskId === task.id ? 'ring-1' : ''
      }`}
    >
      <div className="flex items-start gap-1.5">
        <span className={task.status === 'done' ? 'text-faint line-through' : ''}>{task.title}</span>
        <ChevronRight size={14} className="ml-auto mt-0.5 shrink-0 text-faint" />
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
        <Flag size={12} style={{ color: PRIORITY_COLOR[task.priority] }} fill={task.priority === 'high' ? PRIORITY_COLOR.high : 'none'} />
        {task.due_date && (
          <span className="flex items-center gap-1">
            <CalendarClock size={12} />
            {format(new Date(task.due_date), 'd MMM')}
          </span>
        )}
        {task.note_id !== null && <FileText size={12} aria-label="Linked note" />}
      </div>
    </div>
  )
}
