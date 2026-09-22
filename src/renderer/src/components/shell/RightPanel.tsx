import { useEffect, useState } from 'react'
import { PanelRightClose, PanelRightOpen, FileText } from 'lucide-react'
import { format } from 'date-fns'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { inputCls } from '@/components/ui'
import type { Task } from '@shared/types'

const api = window.inkling

/** The panel exists only while a task is selected: it is that task's detail view. */
export function RightPanel(): React.JSX.Element | null {
  const { tab, selectedTaskId } = useApp()
  const [collapsed, setCollapsed] = useState(false)

  if (tab !== 'tasks' || selectedTaskId === null) return null

  if (collapsed) {
    return (
      <button
        type="button"
        title="Open context panel"
        onClick={() => setCollapsed(false)}
        className="flex w-7 shrink-0 items-start justify-center pt-3 text-faint hover:text-ink"
      >
        <PanelRightOpen size={16} />
      </button>
    )
  }

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-l border-edge bg-panel">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-faint">Task</span>
        <button type="button" title="Collapse panel" onClick={() => setCollapsed(true)} className="text-faint hover:text-ink">
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <TaskContext taskId={selectedTaskId} />
      </div>
    </aside>
  )
}

/* ----------------------------- Selected task ------------------------------ */

function TaskContext({ taskId }: { taskId: number }): React.JSX.Element {
  const version = useVersion('tasks')
  const { notebooks } = useApp()
  const [task, setTask] = useState<Task | null>(null)
  const [title, setTitle] = useState('')

  useEffect(() => {
    void api.tasks.get(taskId).then((t) => {
      setTask(t)
      setTitle(t?.title ?? '')
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

      <PanelField label="Status">
        <div className="flex gap-1">
          {(
            [
              ['todo', 'To do'],
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

      <p className="text-xs text-faint">
        In {notebooks.find((n) => n.id === task.notebook_id)?.name ?? 'notebook'} · created {format(new Date(task.created_at), 'd MMM yyyy')}
      </p>
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
