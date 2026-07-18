import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Plus, Trash2, Palette } from 'lucide-react'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { stickyColors, COLOR_KEYS, isColorKey } from '@/lib/colors'
import { EmptyState } from '@/components/Inky'
import { Button } from '@/components/ui'
import type { Note, Notebook } from '@shared/types'

const api = window.inkling

const DEFAULT_W = 230
const DEFAULT_H = 190

export function StickyBoard({ notebook }: { notebook: Notebook }): React.JSX.Element {
  const version = useVersion('notes')
  const [stickies, setStickies] = useState<Note[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.notes.list(notebook.id, 'sticky').then(setStickies)
  }, [notebook.id, version])

  const addSticky = async (): Promise<void> => {
    const el = scrollRef.current
    const x = (el?.scrollLeft ?? 0) + 60 + ((stickies.length * 28) % 240)
    const y = (el?.scrollTop ?? 0) + 40 + ((stickies.length * 24) % 200)
    const colorKey = COLOR_KEYS[stickies.length % COLOR_KEYS.length]
    await api.notes.create({
      notebook_id: notebook.id,
      type: 'sticky',
      color: colorKey,
      pos_x: x,
      pos_y: y,
      width: DEFAULT_W,
      height: DEFAULT_H
    })
    bumpData('notes')
  }

  return (
    <div className="relative h-full">
      <div ref={scrollRef} className="h-full overflow-auto">
        <div className="relative" style={{ width: 2200, height: 1600 }}>
          {stickies.map((s) => (
            <Sticky key={s.id} note={s} />
          ))}
          {stickies.length === 0 && (
            <div className="absolute inset-x-0 top-0 h-[70vh]">
              <EmptyState
                pose="neutral"
                color={isColorKey(notebook.color) ? notebook.color : 'teal'}
                title="A blank board, full of possibility"
                hint="Stickies are quick, freeform thoughts. Drag them anywhere, resize them, recolor them."
                action={
                  <Button variant="primary" onClick={() => void addSticky()}>
                    <Plus size={14} /> Add a sticky
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        title="New sticky"
        onClick={() => void addSticky()}
        className="absolute bottom-5 right-5 flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105"
        style={{ background: 'var(--accent)' }}
      >
        <Plus size={20} />
      </button>
    </div>
  )
}

function Sticky({ note }: { note: Note }): React.JSX.Element {
  const theme = useApp((s) => s.theme)
  const [pos, setPos] = useState({ x: note.pos_x ?? 60, y: note.pos_y ?? 60 })
  const [size, setSize] = useState({ w: note.width ?? DEFAULT_W, h: note.height ?? DEFAULT_H })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const colors = stickyColors(note.color, theme)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false }),
      Placeholder.configure({ placeholder: 'Jot something…' })
    ],
    content: safeParse(note.content),
    onUpdate: ({ editor }) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void api.notes.update(note.id, { content: JSON.stringify(editor.getJSON()) })
      }, 400)
    }
  })

  // Flush any pending debounced save on unmount (module/notebook switch) and on window blur,
  // so a quick edit isn't stranded on the 400ms timer. A save that lands after the note was
  // deleted is a harmless no-op (updateNote returns null for a missing row).
  useEffect(() => {
    const flush = (): void => {
      if (timerRef.current && editor && !editor.isDestroyed) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        void api.notes.update(note.id, { content: JSON.stringify(editor.getJSON()) })
      }
    }
    window.addEventListener('blur', flush)
    return () => {
      window.removeEventListener('blur', flush)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // dragging by the header strip
  const onDragStart = (e: React.PointerEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const orig = { ...pos }
    const move = (ev: PointerEvent): void => {
      setPos({ x: Math.max(0, orig.x + ev.clientX - startX), y: Math.max(0, orig.y + ev.clientY - startY) })
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const nx = Math.max(0, orig.x + ev.clientX - startX)
      const ny = Math.max(0, orig.y + ev.clientY - startY)
      void api.notes.update(note.id, { pos_x: nx, pos_y: ny })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onResizeStart = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const orig = { ...size }
    const move = (ev: PointerEvent): void => {
      setSize({ w: Math.max(160, orig.w + ev.clientX - startX), h: Math.max(120, orig.h + ev.clientY - startY) })
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      void api.notes.update(note.id, {
        width: Math.max(160, orig.w + ev.clientX - startX),
        height: Math.max(120, orig.h + ev.clientY - startY)
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const cycleColor = (): void => {
    const idx = COLOR_KEYS.indexOf(isColorKey(note.color) ? note.color : 'teal')
    const next = COLOR_KEYS[(idx + 1) % COLOR_KEYS.length]
    void api.notes.update(note.id, { color: next }).then(() => bumpData('notes'))
  }

  return (
    <div
      className="group absolute flex flex-col overflow-hidden rounded-lg shadow-md"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, background: colors.bg, border: `1px solid ${colors.edge}` }}
    >
      <div className="flex h-6 shrink-0 cursor-grab items-center justify-end gap-1 px-1 active:cursor-grabbing" onPointerDown={onDragStart}>
        <button
          type="button"
          title="Change color"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={cycleColor}
          className="hidden h-5 w-5 items-center justify-center rounded opacity-70 hover:opacity-100 group-hover:flex"
          style={{ color: colors.text }}
        >
          <Palette size={14} />
        </button>
        <button
          type="button"
          title="Delete sticky"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => void api.notes.remove(note.id).then(() => bumpData('notes'))}
          className="hidden h-5 w-5 items-center justify-center rounded opacity-70 hover:opacity-100 group-hover:flex"
          style={{ color: colors.text }}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 text-sm" style={{ color: colors.text }}>
        <EditorContent editor={editor} />
      </div>
      <div className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" onPointerDown={onResizeStart} aria-hidden>
        <svg viewBox="0 0 10 10" className="h-full w-full opacity-40" style={{ color: colors.text }}>
          <path d="M9 3 L3 9 M9 6 L6 9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </div>
    </div>
  )
}

function safeParse(content: string): object {
  try {
    return JSON.parse(content)
  } catch {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }
}
