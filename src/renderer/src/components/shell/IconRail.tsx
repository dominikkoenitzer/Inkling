import { useState } from 'react'
import { Plus, Settings } from 'lucide-react'
import { useApp } from '@/stores/app'
import { RAMPS, COLOR_KEYS, isColorKey } from '@/lib/colors'
import { Inky } from '@/components/Inky'
import { Modal, Field, inputCls, Button } from '@/components/ui'
import type { ColorKey } from '@shared/types'

const api = window.inkling

export function IconRail(): React.JSX.Element {
  const { notebooks, activeNotebookId, setActiveNotebook, setSettingsOpen, streak, celebrating, refreshNotebooks } = useApp()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<ColorKey>('teal')

  const active = notebooks.find((n) => n.id === activeNotebookId)
  const inkyColor = isColorKey(active?.color) ? active!.color : 'teal'
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const activeToday = streak.last_day === todayStr

  const createNotebook = async (): Promise<void> => {
    if (!name.trim()) return
    const nb = await api.notebooks.create({ name: name.trim(), color })
    await refreshNotebooks()
    setActiveNotebook(nb.id)
    setAdding(false)
    setName('')
  }

  return (
    <nav className="flex w-[68px] shrink-0 flex-col items-center gap-2 overflow-y-auto py-2" aria-label="Notebooks">
      {notebooks.map((nb) => {
        const r = RAMPS[isColorKey(nb.color) ? nb.color : 'gray']
        const isActive = nb.id === activeNotebookId
        return (
          <button
            key={nb.id}
            type="button"
            title={nb.name}
            onClick={() => setActiveNotebook(nb.id)}
            className={`group relative flex h-11 w-11 items-center justify-center font-semibold text-white transition-all duration-150 ${
              isActive ? 'rounded-2xl' : 'rounded-[22px] hover:rounded-2xl'
            }`}
            style={{ background: r[500] }}
          >
            {isActive && <span className="absolute -left-[13px] h-7 w-1 rounded-r-full bg-ink" aria-hidden />}
            {nb.is_journal ? '📓' : nb.name.slice(0, 2)}
          </button>
        )
      })}

      <button
        type="button"
        title="New notebook"
        onClick={() => setAdding(true)}
        className="flex h-11 w-11 items-center justify-center rounded-[22px] border border-dashed border-edge text-muted transition-all hover:rounded-2xl hover:bg-hover hover:text-ink"
      >
        <Plus size={18} />
      </button>

      <div className="flex-1" />

      <button
        type="button"
        title="Settings (Ctrl+,)"
        onClick={() => setSettingsOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-hover hover:text-ink"
      >
        <Settings size={17} />
      </button>

      <div
        className="flex flex-col items-center pb-1"
        title={
          streak.count > 0
            ? `Study streak: ${streak.count} day${streak.count === 1 ? '' : 's'}${activeToday ? ' — active today!' : ''}`
            : 'Finish a focus session or review some flashcards to start a streak'
        }
      >
        <Inky pose={celebrating ? 'happy' : activeToday ? 'neutral' : 'sleepy'} color={inkyColor} size={40} />
        <span className="text-[11px] font-semibold text-muted">{streak.count > 0 ? `${streak.count}d` : '·'}</span>
      </div>

      {adding && (
        <Modal title="New notebook" onClose={() => setAdding(false)}>
          <Field label="Name">
            <input
              autoFocus
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void createNotebook()}
              placeholder="e.g. Biology 101"
            />
          </Field>
          <Field label="Color">
            <div className="flex gap-2">
              {COLOR_KEYS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full transition-transform ${color === c ? 'scale-110 ring-2 ring-offset-2' : 'hover:scale-105'}`}
                  style={{ background: RAMPS[c][500], ['--tw-ring-color' as never]: RAMPS[c][500], ['--tw-ring-offset-color' as never]: 'var(--bg-panel)' }}
                />
              ))}
            </div>
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void createNotebook()} disabled={!name.trim()}>
              Create
            </Button>
          </div>
        </Modal>
      )}
    </nav>
  )
}
