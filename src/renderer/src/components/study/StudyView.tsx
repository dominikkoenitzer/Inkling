import { useEffect, useState } from 'react'
import { Play, Trash2, Plus, ArrowLeft, Pencil, Layers } from 'lucide-react'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { isColorKey, ramp } from '@/lib/colors'
import { EmptyState } from '@/components/Inky'
import { Button, IconBtn, inputCls } from '@/components/ui'
import { FocusTimer } from './FocusTimer'
import { ReviewSession } from './ReviewSession'
import type { Notebook, Deck, Card } from '@shared/types'

const api = window.inkling

export function StudyView({ notebook }: { notebook: Notebook }): React.JSX.Element {
  const { selectedDeckId, setSelectedDeck } = useApp()
  const version = useVersion('decks')
  const [decks, setDecks] = useState<Deck[]>([])
  const [reviewingDeck, setReviewingDeck] = useState<Deck | null>(null)

  useEffect(() => {
    void api.decks.list(notebook.id).then(setDecks)
  }, [notebook.id, version])

  const color = isColorKey(notebook.color) ? notebook.color : 'teal'

  if (reviewingDeck) {
    return <ReviewSession deck={reviewingDeck} onDone={() => setReviewingDeck(null)} />
  }

  const selected = decks.find((d) => d.id === selectedDeckId)
  if (selected) {
    return <DeckDetail deck={selected} onBack={() => setSelectedDeck(null)} onReview={() => setReviewingDeck(selected)} />
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto grid max-w-4xl gap-5 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-3 text-[15px] font-bold">Flashcard decks</h2>
          {decks.length === 0 ? (
            <div className="rounded-xl border border-edge bg-panel">
              <EmptyState
                pose="wave"
                color={color}
                title="First flashcard deck? Let’s make it"
                hint="Create one in the sidebar, or write “Term :: Definition” lines in any note and hit the ✨ Flashcards button."
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {decks.map((d) => (
                <div key={d.id} className="rounded-xl border border-edge bg-panel p-4 transition-colors hover:bg-raised">
                  <button type="button" className="mb-1 flex w-full items-center gap-2 text-left" onClick={() => useApp.getState().setSelectedDeck(d.id)}>
                    <Layers size={15} style={{ color: ramp(notebook.color)[500] }} />
                    <span className="truncate font-semibold">{d.name}</span>
                  </button>
                  <div className="mb-3 text-xs text-muted">
                    {d.card_count} card{d.card_count === 1 ? '' : 's'}
                    {d.due_count > 0 ? ` · ${d.due_count} due now` : d.card_count > 0 ? ' · all caught up ✨' : ''}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={() => setReviewingDeck(d)} disabled={d.due_count === 0}>
                      <Play size={13} /> Review {d.due_count > 0 ? `(${d.due_count})` : ''}
                    </Button>
                    <Button variant="ghost" onClick={() => useApp.getState().setSelectedDeck(d.id)}>
                      <Pencil size={13} /> Edit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-[15px] font-bold">Focus timer</h2>
          <FocusTimer notebook={notebook} decks={decks} />
        </section>
      </div>
    </div>
  )
}

/* -------------------------------- Deck detail ------------------------------ */

function DeckDetail({ deck, onBack, onReview }: { deck: Deck; onBack: () => void; onReview: () => void }): React.JSX.Element {
  const version = useVersion('decks')
  const [cards, setCards] = useState<Card[]>([])
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(deck.name)

  useEffect(() => {
    void api.decks.cards(deck.id).then(setCards)
  }, [deck.id, version])

  const add = async (): Promise<void> => {
    if (!front.trim() || !back.trim()) return
    await api.decks.addCard(deck.id, front.trim(), back.trim())
    setFront('')
    setBack('')
    bumpData('decks')
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center gap-2">
          <IconBtn title="Back to decks" onClick={onBack}>
            <ArrowLeft size={16} />
          </IconBtn>
          {renaming ? (
            <input
              autoFocus
              className={`${inputCls} max-w-xs`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setRenaming(false)
                if (name.trim() && name !== deck.name) void api.decks.rename(deck.id, name.trim()).then(() => bumpData('decks'))
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <h2 className="cursor-text text-lg font-bold" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
              {deck.name}
            </h2>
          )}
          <span className="text-sm text-muted">· {cards.length} cards</span>
          <div className="ml-auto flex gap-2">
            <Button variant="primary" onClick={onReview} disabled={deck.due_count === 0}>
              <Play size={13} /> Review {deck.due_count > 0 ? `(${deck.due_count})` : ''}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void api.decks.remove(deck.id).then(() => {
                  bumpData('decks')
                  onBack()
                })
              }}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-[1fr_1fr_auto] gap-2 rounded-xl border border-edge bg-panel p-3">
          <input className={inputCls} placeholder="Front — the question or term" value={front} onChange={(e) => setFront(e.target.value)} />
          <input
            className={inputCls}
            placeholder="Back — the answer"
            value={back}
            onChange={(e) => setBack(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <Button variant="primary" onClick={() => void add()} disabled={!front.trim() || !back.trim()}>
            <Plus size={14} />
          </Button>
        </div>

        {cards.length === 0 && <p className="py-6 text-center text-sm text-muted">No cards yet — add your first one above.</p>}
        <div className="space-y-1.5">
          {cards.map((c) => (
            <CardRow key={c.id} card={c} />
          ))}
        </div>
      </div>
    </div>
  )
}

function CardRow({ card }: { card: Card }): React.JSX.Element {
  const [front, setFront] = useState(card.front)
  const [back, setBack] = useState(card.back)

  const save = (): void => {
    if (front !== card.front || back !== card.back) {
      void api.decks.updateCard(card.id, front, back).then(() => bumpData('decks'))
    }
  }

  const due = new Date(card.next_review_date) <= new Date()

  return (
    <div className="group grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-lg border border-edge bg-panel px-3 py-2">
      <input className="bg-transparent text-sm" value={front} onChange={(e) => setFront(e.target.value)} onBlur={save} />
      <input className="border-l border-edge bg-transparent pl-3 text-sm text-muted" value={back} onChange={(e) => setBack(e.target.value)} onBlur={save} />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-faint" title={`ease ${card.ease_factor.toFixed(2)} · interval ${card.interval_days}d`}>
          {due ? 'due' : `in ${card.interval_days}d`}
        </span>
        <button
          type="button"
          title="Delete card"
          className="hidden text-faint hover:text-red-400 group-hover:block"
          onClick={() => void api.decks.removeCard(card.id).then(() => bumpData('decks'))}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}
