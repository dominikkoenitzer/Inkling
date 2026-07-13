import { useState } from 'react'
import { format } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { useApp, bumpData } from '@/stores/app'
import { makeWeeklyRule } from '@/lib/recur'
import { Modal, Field, inputCls, Button } from '@/components/ui'
import { RAMPS, isColorKey } from '@/lib/colors'

const api = window.inkling

export interface EventDraft {
  id: number | null
  notebook_id: number
  title: string
  start: Date
  end: Date
  byday: string[]
}

const DAY_OPTIONS = [
  { code: 'MO', label: 'Mon' },
  { code: 'TU', label: 'Tue' },
  { code: 'WE', label: 'Wed' },
  { code: 'TH', label: 'Thu' },
  { code: 'FR', label: 'Fri' },
  { code: 'SA', label: 'Sat' },
  { code: 'SU', label: 'Sun' }
]

export function EventDialog({ draft, onClose }: { draft: EventDraft; onClose: () => void }): React.JSX.Element {
  const { notebooks } = useApp()
  const [title, setTitle] = useState(draft.title)
  const [notebookId, setNotebookId] = useState(draft.notebook_id)
  const [date, setDate] = useState(format(draft.start, 'yyyy-MM-dd'))
  const [startTime, setStartTime] = useState(format(draft.start, 'HH:mm'))
  const [endTime, setEndTime] = useState(format(draft.end, 'HH:mm'))
  const [byday, setByday] = useState<string[]>(draft.byday)

  const save = async (): Promise<void> => {
    if (!title.trim()) return
    const start = new Date(`${date}T${startTime}`)
    let end = new Date(`${date}T${endTime}`)
    if (end <= start) end = new Date(start.getTime() + 30 * 60 * 1000)
    const payload = {
      notebook_id: notebookId,
      title: title.trim(),
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      recurrence_rule: makeWeeklyRule(byday)
    }
    if (draft.id === null) await api.events.create(payload)
    else await api.events.update(draft.id, payload)
    bumpData('events')
    onClose()
  }

  const remove = async (): Promise<void> => {
    if (draft.id !== null) {
      await api.events.remove(draft.id)
      bumpData('events')
    }
    onClose()
  }

  return (
    <Modal title={draft.id === null ? 'New event' : 'Edit event'} onClose={onClose}>
      <Field label="Title">
        <input
          autoFocus
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Biology 101"
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Date">
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Starts">
          <input type="time" className={inputCls} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field label="Ends">
          <input type="time" className={inputCls} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Notebook">
        <div className="flex flex-wrap gap-1.5">
          {notebooks.map((nb) => (
            <button
              key={nb.id}
              type="button"
              onClick={() => setNotebookId(nb.id)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                notebookId === nb.id ? 'border-transparent text-white' : 'border-edge text-muted hover:text-ink'
              }`}
              style={notebookId === nb.id ? { background: RAMPS[isColorKey(nb.color) ? nb.color : 'gray'][500] } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: RAMPS[isColorKey(nb.color) ? nb.color : 'gray'][notebookId === nb.id ? 200 : 500] }} />
              {nb.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Repeats weekly on (class schedule mode)">
        <div className="flex gap-1">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d.code}
              type="button"
              onClick={() => setByday((prev) => (prev.includes(d.code) ? prev.filter((x) => x !== d.code) : [...prev, d.code]))}
              className={`flex-1 rounded-lg border py-1 text-xs font-semibold transition-colors ${
                byday.includes(d.code) ? 'border-transparent text-white' : 'border-edge text-muted hover:text-ink'
              }`}
              style={byday.includes(d.code) ? { background: 'var(--accent)' } : undefined}
            >
              {d.label}
            </button>
          ))}
        </div>
        {byday.length > 0 && <p className="mt-1.5 text-[11px] text-faint">Set once — repeats automatically every week from the start date.</p>}
      </Field>
      <div className="mt-4 flex items-center justify-between">
        {draft.id !== null ? (
          <Button variant="danger" onClick={() => void remove()}>
            <Trash2 size={14} /> Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!title.trim()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
