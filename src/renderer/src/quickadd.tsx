import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { StickyNote, CheckSquare, CalendarDays } from 'lucide-react'
import { parseQuickText } from './lib/parse'
import './styles/index.css'

const api = window.inkling

type Kind = 'note' | 'task' | 'event'

function QuickAdd(): React.JSX.Element {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<Kind>('task')
  const [savedFlash, setSavedFlash] = useState(false)
  const parsed = parseQuickText(text)
  const savingRef = useRef(false)
  const hadWhenRef = useRef(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void api.settings.all().then((s) => {
      document.documentElement.dataset.theme = s['theme'] === 'cozy' ? 'cozy' : 'dark'
    })
  }, [])

  // Auto-suggest task the FIRST time a date-ish phrase appears (§7) — but only as a one-shot
  // nudge, so a deliberate click on "Note" for a dated capture isn't yanked back to "Task".
  useEffect(() => {
    const hasWhen = !!parsed.when
    if (hasWhen && !hadWhenRef.current && kind === 'note') setKind('task')
    hadWhenRef.current = hasWhen
  }, [parsed.when, kind])

  const save = async (): Promise<void> => {
    if (savingRef.current || !text.trim()) return // ignore a double Enter while the write is in flight
    savingRef.current = true
    try {
      await api.app.quickAdd({
        kind,
        text: parsed.text,
        due: kind === 'task' && parsed.when ? parsed.when.toISOString() : null,
        start: kind === 'event' && parsed.when ? parsed.when.toISOString() : null
      })
    } finally {
      savingRef.current = false
    }
    setText('')
    setSavedFlash(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null
      setSavedFlash(false)
      void api.app.hideQuickAdd() // onChange cancels this timer if a new capture was started
    }, 450)
  }

  const kinds: Array<{ id: Kind; icon: React.JSX.Element; label: string }> = [
    { id: 'note', icon: <StickyNote size={13} />, label: 'Note' },
    { id: 'task', icon: <CheckSquare size={13} />, label: 'Task' },
    { id: 'event', icon: <CalendarDays size={13} />, label: 'Event' }
  ]

  return (
    <div className="flex h-screen flex-col justify-center gap-2 rounded-xl border border-edge bg-panel px-4 py-3">
      <input
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          // starting a new capture cancels the pending auto-hide so the window doesn't vanish mid-typing
          if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current)
            hideTimerRef.current = null
          }
          if (savedFlash) setSavedFlash(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
          if (e.key === 'Escape') void api.app.hideQuickAdd()
        }}
        placeholder="Quick capture… try “essay draft friday at 5pm”"
        className="w-full bg-transparent text-lg text-ink placeholder:text-faint"
      />
      <div className="flex items-center gap-1.5">
        {kinds.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium ${
              kind === k.id ? 'border-transparent text-white' : 'border-edge text-muted'
            }`}
            style={kind === k.id ? { background: '#1d9e75' } : undefined}
          >
            {k.icon}
            {k.label}
          </button>
        ))}
        {parsed.when && kind !== 'note' && (
          <span className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: 'rgba(29,158,117,.18)', color: '#3db58b' }}>
            📅 {parsed.hint}
          </span>
        )}
        <span className="ml-auto text-[11px] text-faint">{savedFlash ? 'Saved ✓' : 'Enter to save · Esc to close'}</span>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QuickAdd />
  </React.StrictMode>
)
