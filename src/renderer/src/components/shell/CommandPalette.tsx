import { useEffect, useRef, useState } from 'react'
import { Search, FileText, CheckSquare, Layers, Plus, Sun, Keyboard, Settings } from 'lucide-react'
import { useApp } from '@/stores/app'
import { searchFor } from '@/lib/calls'
import { ariaKeys, closesSheet, keyLabel, shortcutsKey } from '@/lib/keys'
import { noop, useExit, useReturnFocus, type Exit } from '@/lib/motion'
import type { SearchResult } from '@shared/types'

interface Item {
  key: string
  icon: React.JSX.Element
  label: string
  detail?: string
  /** Its shortcut, written as "Ctrl+N". */
  keys?: string
  run: () => void
}

/** Ctrl+K: search notes, to-dos and decks, or jump to a place or action by name. */
export function CommandPalette({ closing = false, onGone = noop }: Exit): React.JSX.Element {
  const [query, setQuery] = useState('')
  // Results remember the query they answer, so Enter never acts on an older one.
  const [results, setResults] = useState<{ query: string; hits: SearchResult[]; failed: boolean }>({ query: '', hits: [], failed: false })
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const close = (): void => useApp.getState().setPaletteOpen(false)

  const listRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const onExitEnd = useExit(sheetRef, closing, onGone)

  // Focus the box, and give focus back to where it was as the palette starts to close.
  useReturnFocus(closing, inputRef)

  useEffect(() => {
    const q = query.trim()
    if (!q) return
    const t = setTimeout(() => void searchFor(q).then(setResults), 120)
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
  const actions: Item[] = [
    { key: 'new-note', icon: <Plus size={16} />, label: 'New note', keys: 'Ctrl+N', run: () => void app.newNote().then(close) },
    { key: 'today', icon: <Sun size={16} />, label: 'Today', keys: 'Ctrl+1', run: () => app.setView('today') },
    { key: 'study', icon: <Layers size={16} />, label: 'Flashcards', keys: 'Ctrl+2', run: () => app.setView('study') },
    { key: 'shortcuts', icon: <Keyboard size={16} />, label: 'Keyboard shortcuts', keys: shortcutsKey(), run: () => app.setShortcutsOpen(true) },
    { key: 'settings', icon: <Settings size={16} />, label: 'Settings', keys: 'Ctrl+,', run: () => app.setSettingsOpen(true) }
  ]
  // With nothing typed every action shows; while searching, the ones whose name matches,
  // and New note always, so Enter on a miss still starts one.
  const lower = q.toLowerCase()
  const matching = q ? actions.filter((a) => a.key === 'new-note' || a.label.toLowerCase().includes(lower)) : actions
  const items: Item[] = [...found, ...matching]
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
    if (closesSheet(e.nativeEvent)) {
      e.preventDefault()
      close()
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(Math.min(clamped + 1, items.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(Math.max(clamped - 1, 0))
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      // Handled here, so the key never reaches what gets focus once the palette closes.
      e.preventDefault()
      // While the answer for what was just typed is on its way, Enter waits for it.
      if (pending) enterWaiting.current = true
      else items[clamped]?.run()
    }
  }

  return (
    // A closing palette sits under anything that opens in its place and takes no input.
    <div
      className={`no-drag fixed inset-0 flex items-start justify-center pt-[15vh] ${closing ? 'pointer-events-none z-40' : 'z-50'}`}
      inert={closing || undefined}
      onMouseDown={close}
    >
      <div
        ref={sheetRef}
        role={closing ? undefined : 'dialog'}
        aria-modal={closing ? undefined : 'true'}
        aria-label="Search"
        data-search=""
        data-closing={closing || undefined}
        onAnimationEnd={onExitEnd}
        className="motion-sheet w-[560px] overflow-hidden rounded-lg border border-edge bg-raised"
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
            placeholder="Search notes, to-dos and decks"
            aria-label="Search"
            className="h-12 flex-1 bg-transparent text-[15px] placeholder:text-faint"
          />
        </div>
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
          {q && !pending && !results.failed && found.length === 0 && matching.length === 1 && (
            <p className="px-3 py-3 text-sm text-faint">Nothing found.</p>
          )}
          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              onMouseEnter={() => setSelected(i)}
              onClick={item.run}
              aria-keyshortcuts={item.keys && ariaKeys(item.keys)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm ${clamped === i ? 'bg-active text-ink' : 'text-ink'}`}
            >
              <span className="text-faint">{item.icon}</span>
              <span className="shrink-0">{item.label}</span>
              {(item.keys || item.detail) && (
                <span aria-hidden={item.keys ? true : undefined} className={`ml-auto truncate pl-3 text-xs ${clamped === i ? 'text-muted' : 'text-faint'}`}>
                  {item.keys ? keyLabel(item.keys) : item.detail}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
