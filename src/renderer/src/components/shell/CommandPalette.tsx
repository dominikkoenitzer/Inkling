import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, FileText, CheckSquare, Layers, Zap, Percent, Moon, Sun, Plus, GraduationCap } from 'lucide-react'
import { useApp, bumpData } from '@/stores/app'
import { fuzzyScore } from '@/lib/parse'
import type { SearchResult } from '@shared/types'

const api = window.inkling

interface PaletteItem {
  key: string
  icon: React.JSX.Element
  label: string
  detail?: string
  run: () => void
}

export function CommandPalette(): React.JSX.Element {
  const app = useApp()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const close = (): void => app.setPaletteOpen(false)

  useEffect(() => inputRef.current?.focus(), [])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    const t = setTimeout(() => void api.search.query(q).then(setResults), 120)
    return () => clearTimeout(t)
  }, [query])

  const actions: PaletteItem[] = useMemo(() => {
    const nb = app.notebooks.find((n) => n.id === app.activeNotebookId)
    const list: PaletteItem[] = []
    if (nb) {
      list.push(
        {
          key: 'new-note',
          icon: <Plus size={16} />,
          label: 'New page',
          detail: `in ${nb.name}`,
          run: () => {
            void api.notes.create({ notebook_id: nb.id, type: 'page' }).then((n) => {
              bumpData('notes')
              app.openNote(nb.id, n.id)
            })
          }
        },
        {
          key: 'new-task',
          icon: <CheckSquare size={16} />,
          label: 'New task',
          detail: `in ${nb.name}`,
          run: () => {
            app.setTab('tasks')
            app.setSmartView(null)
            close()
          }
        },
        {
          key: 'focus',
          icon: <Zap size={16} />,
          label: 'Start focus session',
          run: () => {
            app.setTab('study')
            app.setSelectedDeck(null)
            close()
          }
        }
      )
    }
    list.push(
      { key: 'go-today', icon: <Sun size={16} />, label: 'Jump to Today', run: () => { app.setTab('today'); close() } },
      { key: 'go-notes', icon: <FileText size={16} />, label: 'Jump to Notes', run: () => { app.setTab('notes'); close() } },
      { key: 'go-tasks', icon: <CheckSquare size={16} />, label: 'Jump to Tasks', run: () => { app.setTab('tasks'); close() } },
      { key: 'go-study', icon: <GraduationCap size={16} />, label: 'Jump to Study', run: () => { app.setTab('study'); close() } },
      { key: 'go-grades', icon: <Percent size={16} />, label: 'Jump to Grades', run: () => { app.setTab('grades'); close() } },
      {
        key: 'theme',
        icon: app.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />,
        label: app.theme === 'dark' ? 'Switch to Cozy theme' : 'Switch to Dark theme',
        run: () => {
          app.setTheme(app.theme === 'dark' ? 'cozy' : 'dark')
          close()
        }
      }
    )
    return list.filter((a) => fuzzyScore(query, a.label) >= 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, app.notebooks, app.activeNotebookId, app.theme])

  const searchItems: PaletteItem[] = results.map((r) => ({
    key: `s-${r.source_type}-${r.source_id}`,
    icon: r.source_type === 'note' ? <FileText size={16} /> : r.source_type === 'task' ? <CheckSquare size={16} /> : <Layers size={16} />,
    label: r.title || 'Untitled',
    detail: r.snippet.replace(/[⟪⟫]/g, ''),
    run: () => {
      if (r.source_type === 'note') app.openNote(r.notebook_id, r.source_id)
      else if (r.source_type === 'task') app.openTask(r.notebook_id, r.source_id)
      else app.openDeck(r.notebook_id, r.source_id)
    }
  }))

  const items = [...searchItems, ...actions]
  const clamped = Math.min(selected, Math.max(0, items.length - 1))

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') close()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, items.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    }
    if (e.key === 'Enter' && items[clamped]) {
      items[clamped].run()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[14vh]" onMouseDown={close}>
      <div
        className="pop-in w-[560px] overflow-hidden rounded-xl border border-edge bg-panel"
        style={{ boxShadow: 'var(--shadow)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <Search size={16} className="text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={onKey}
            placeholder="Search notes, tasks, decks, or run a command…"
            className="flex-1 bg-transparent text-[15px] placeholder:text-faint"
          />
          <kbd className="rounded border border-edge px-1.5 py-0.5 text-[11px] text-faint">esc</kbd>
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-1.5">
          {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-faint">Nothing found. Try different words?</p>}
          {searchItems.length > 0 && <GroupLabel>Results</GroupLabel>}
          {searchItems.map((item, i) => (
            <Row key={item.key} item={item} active={clamped === i} onHover={() => setSelected(i)} />
          ))}
          {actions.length > 0 && <GroupLabel>Actions</GroupLabel>}
          {actions.map((item, i) => (
            <Row key={item.key} item={item} active={clamped === searchItems.length + i} onHover={() => setSelected(searchItems.length + i)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-faint">{children}</div>
}

function Row({ item, active, onHover }: { item: PaletteItem; active: boolean; onHover: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={item.run}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${active ? 'text-white' : 'text-ink'}`}
      style={active ? { background: 'var(--accent)' } : undefined}
    >
      <span className={active ? 'text-white' : 'text-muted'}>{item.icon}</span>
      <span className="shrink-0 font-medium">{item.label}</span>
      {item.detail && <span className={`truncate text-xs ${active ? 'text-white/75' : 'text-faint'}`}>{item.detail}</span>}
    </button>
  )
}
