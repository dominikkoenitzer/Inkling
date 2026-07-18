import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useApp } from '@/stores/app'
import { RAMPS, COLOR_KEYS, isColorKey } from '@/lib/colors'
import { NotebookGlyph, JournalIcon, hasGlyph } from '@/lib/icons'
import { Modal, Field, inputCls, Button, IconPicker } from '@/components/ui'
import type { ColorKey } from '@shared/types'

const api = window.inkling

export function IconRail(): React.JSX.Element {
  const { notebooks, activeNotebookId, setActiveNotebook, refreshNotebooks } = useApp()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<ColorKey>('teal')
  const [icon, setIcon] = useState<string | null>(null)

  const createNotebook = async (): Promise<void> => {
    if (!name.trim()) return
    const nb = await api.notebooks.create({ name: name.trim(), color, icon })
    await refreshNotebooks()
    setActiveNotebook(nb.id)
    setAdding(false)
    setName('')
    setIcon(null)
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
            className={`group relative flex h-11 w-11 shrink-0 items-center justify-center font-semibold text-white transition-all duration-150 active:scale-95 ${
              isActive ? 'rounded-2xl' : 'rounded-[22px] hover:scale-[1.04] hover:rounded-2xl'
            }`}
            style={{ background: `linear-gradient(135deg, ${r[400]}, ${r[600]})` }}
          >
            {isActive && <span className="absolute -left-[13px] h-7 w-1 rounded-r-full bg-ink" aria-hidden />}
            {hasGlyph(nb.icon) ? (
              <NotebookGlyph icon={nb.icon} size={20} />
            ) : nb.is_journal ? (
              <JournalIcon size={20} />
            ) : (
              nb.name.slice(0, 2)
            )}
          </button>
        )
      })}

      <button
        type="button"
        title="New notebook"
        onClick={() => setAdding(true)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[22px] border border-dashed border-edge text-muted transition-all hover:rounded-2xl hover:bg-hover hover:text-ink active:scale-95"
      >
        <Plus size={18} />
      </button>

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
          <Field label="Icon">
            <IconPicker value={icon} onChange={setIcon} />
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
