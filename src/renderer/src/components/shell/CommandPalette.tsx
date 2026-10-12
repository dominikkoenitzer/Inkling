import { useEffect, useRef, useState } from 'react'
import { Search, FileText, CheckSquare, Layers, Plus } from 'lucide-react'
import { useApp } from '@/stores/app'
import type { SearchResult } from '@shared/types'

const api = window.inkling

interface Item {
  key: string
  icon: React.JSX.Element
  label: string
  detail?: string
  run: () => void
}

/** Ctrl+K: search notes, to-dos and decks, or start a new note. */
export function CommandPalette(): React.JSX.Element {
  const [query, setQuery] = useState('')
  // Results remember the query they answer, so Enter never acts on an older one.
  const [results, setResults] = useState<{ query: string; hits: SearchResult[] }>({ query: '', hits: [] })
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const close = (): void => useApp.getState().setPaletteOpen(false)

  const listRef = useRef<HTMLDivElement>(null)

  // Focus the box, and give focus back to where it was when the palette closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (!q) return
    const t = setTimeout(() => void api.search.query(q).then((hits) => setResults({ query: q, hits })), 120)
    return () => clearTimeout(t)
  }, [query])

  const app = useApp.getState()
  const q = query.trim()
  const pending = q !== '' && results.query !== q
  // The last answer stays on screen while the next one is on its way, so nothing jumps.
  const found: Item[] = (q && results.query ? results.hits : []).map((r) => ({
    key: `${r.source_type}-${r.source_id}`,
    icon: r.source_type === 'note' ? <FileText size={16} /> : r.source_type === 'task' ? <CheckSquare size={16} /> : <Layers size={16} />,
    label: r.title || 'Untitled',
    detail: r.snippet.replace(/[⟪⟫]/g, ''),
    run: () => (r.note_id !== null ? app.openNote(r.note_id) : app.openDeck(r.source_id))
  }))
  const items: Item[] = [
    ...found,
    { key: 'new-note', icon: <Plus size={16} />, label: 'New note', detail: 'Ctrl+N', run: () => void app.newNote().then(close) }
  ]
  const clamped = Math.min(selected, items.length - 1)

  const enterWaiting = useRef(false)
  useEffect(() => {
    if (enterWaiting.current && !pending) {
      enterWaiting.current = false
      items[clamped]?.run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  useEffect(() => {
    listRef.current?.querySelectorAll('button')[clamped]?.scrollIntoView({ block: 'nearest' })
  }, [clamped])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') close()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(Math.min(clamped + 1, items.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(Math.max(clamped - 1, 0))
    }
    if (e.key === 'Enter') {
      // Handled here, so the key never reaches what gets focus once the palette closes.
      e.preventDefault()
      // While the answer for what was just typed is on its way, Enter waits for it.
      if (pending) enterWaiting.current = true
      else items[clamped]?.run()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-[15vh]" onMouseDown={close}>
      <div
        className="w-[560px] overflow-hidden rounded-lg border border-edge bg-raised"
        style={{ boxShadow: 'var(--shadow)' }}
        onMouseDown={(e) => {
          e.stopPropagation()
          // Clicking the panel itself keeps the search box focused, so the keys keep working.
          if (e.target !== inputRef.current) e.preventDefault()
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-edge px-4">
          <Search size={16} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={onKey}
            placeholder="Search your notes"
            className="h-12 flex-1 bg-transparent text-[15px] placeholder:text-faint"
          />
        </div>
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
          {q && !pending && found.length === 0 && <p className="px-3 py-3 text-sm text-faint">Nothing found.</p>}
          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              onMouseEnter={() => setSelected(i)}
              onClick={item.run}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm ${clamped === i ? 'bg-active text-ink' : 'text-ink'}`}
            >
              <span className="text-faint">{item.icon}</span>
              <span className="shrink-0">{item.label}</span>
              {item.detail && <span className="ml-auto truncate pl-3 text-xs text-faint">{item.detail}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
