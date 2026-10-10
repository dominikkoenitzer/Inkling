import { useEffect, useState } from 'react'
import { Trash2, Plus, ArrowLeft, Layers } from 'lucide-react'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { hasCloze } from '@shared/cloze'
import { Inky } from '@/components/Inky'
import { Button, IconBtn, inputCls } from '@/components/ui'
import { onActivateKey } from '@/lib/keys'
import { ReviewSession } from './ReviewSession'
import type { Deck, Card } from '@shared/types'

const api = window.inkling

export function StudyView(): React.JSX.Element {
  const selectedDeckId = useApp((s) => s.selectedDeckId)
  const reviewingDeckId = useApp((s) => s.reviewingDeckId)
  const today = useApp((s) => s.today)
  const version = useVersion('decks')
  const [decks, setDecks] = useState<Deck[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    let stale = false
    void api.decks.list().then((d) => !stale && setDecks(d))
    return () => {
      stale = true
    }
  }, [version, today])

  if (decks === null) return <div />

  const reviewing = decks.find((d) => d.id === reviewingDeckId)
  if (reviewing) return <ReviewSession deck={reviewing} onDone={() => useApp.getState().reviewDeck(null)} />

  const selected = decks.find((d) => d.id === selectedDeckId)
  if (selected) return <DeckDetail deck={selected} />

  const create = async (): Promise<void> => {
    const n = name.trim()
    if (!n) return
    const home = useApp.getState().homeNotebookId ?? (await api.notebooks.home())
    const deck = await api.decks.create(home, n)
    bumpData('decks')
    setAdding(false)
    setName('')
    useApp.getState().openDeck(deck.id)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[680px] px-10 pb-20 pt-14">
        <div className="flex items-end justify-between gap-4">
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">Study</h1>
          <Button onClick={() => setAdding(true)}>
            <Plus size={15} /> New deck
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted">Each card comes back right before you would forget it.</p>

        {adding && (
          <input
            autoFocus
            className={`${inputCls} mt-8`}
            value={name}
            placeholder="Deck name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
              if (e.key === 'Escape') setAdding(false)
            }}
            onBlur={() => !name.trim() && setAdding(false)}
          />
        )}

        {decks.length === 0 && !adding ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <Inky size={44} className="mb-4" />
            <p className="text-[15px]">No decks yet.</p>
            <p className="mt-1 max-w-sm text-sm text-muted">
              Write lines like “Term :: Definition” in a note and press Flashcards, or start a deck here.
            </p>
          </div>
        ) : (
          <ul className="mt-8 border-t border-edge">
            {decks.map((d) => {
              const open = (): void => useApp.getState().openDeck(d.id)
              return (
                <li
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={onActivateKey(open)}
                  className="flex cursor-pointer items-center gap-3 border-b border-edge px-1 py-3 transition-colors hover:bg-hover"
                >
                  <Layers size={16} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{d.name}</span>
                  <span className="shrink-0 text-xs text-faint">
                    {d.card_count} card{d.card_count === 1 ? '' : 's'}
                    {d.due_count > 0 && <span className="text-accent-text"> · {d.due_count} due</span>}
                  </span>
                  {d.due_count > 0 && (
                    <Button
                      variant="ghost"
                      className="h-7 px-2.5 text-accent-text"
                      onClick={() => {
                        useApp.getState().reviewDeck(d.id)
                      }}
                    >
                      Review
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/* -------------------------------- Deck detail ------------------------------ */

function DeckDetail({ deck }: { deck: Deck }): React.JSX.Element {
  const version = useVersion('decks')
  const [cards, setCards] = useState<Card[]>([])
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [name, setName] = useState(deck.name)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    void api.decks.cards(deck.id).then(setCards)
  }, [deck.id, version])

  // A cloze front is a whole card on its own; the back is then an optional extra.
  const canAdd = !!front.trim() && (!!back.trim() || hasCloze(front))

  const add = async (): Promise<void> => {
    if (!canAdd) return
    await api.decks.addCard(deck.id, front.trim(), back.trim())
    setFront('')
    setBack('')
    bumpData('decks')
  }

  const rename = (): void => {
    const n = name.trim()
    if (n && n !== deck.name) void api.decks.rename(deck.id, n).then(() => bumpData('decks'))
    else setName(deck.name)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[680px] px-10 pb-20 pt-10">
        <button
          type="button"
          onClick={() => useApp.getState().openDeck(null)}
          className="-ml-2 mb-6 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <ArrowLeft size={15} /> Study
        </button>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Deck name"
          className="font-display w-full bg-transparent text-[32px] font-semibold leading-tight tracking-tight"
        />
        <div className="mt-2 flex items-center gap-3 text-sm text-muted">
          <span>
            {cards.length} card{cards.length === 1 ? '' : 's'}
            {deck.due_count > 0 && ` · ${deck.due_count} due`}
          </span>
          <span className="ml-auto flex gap-1">
            {deck.due_count > 0 && (
              <Button variant="primary" onClick={() => useApp.getState().reviewDeck(deck.id)}>
                Review now
              </Button>
            )}
            {confirmDelete ? (
              <Button
                variant="danger"
                onClick={() =>
                  void api.decks.remove(deck.id).then(() => {
                    bumpData('decks')
                    useApp.getState().openDeck(null)
                  })
                }
              >
                Delete deck and cards
              </Button>
            ) : (
              <IconBtn title="Delete deck" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} />
              </IconBtn>
            )}
          </span>
        </div>

        <div className="mt-8 grid grid-cols-[1fr_1fr_auto] gap-2">
          <input className={inputCls} placeholder="Front" value={front} onChange={(e) => setFront(e.target.value)} />
          <input
            className={inputCls}
            placeholder="Back"
            value={back}
            onChange={(e) => setBack(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <Button variant="primary" ariaLabel="Add card" onClick={() => void add()} disabled={!canAdd}>
            <Plus size={15} />
          </Button>
        </div>

        {cards.length === 0 ? (
          <p className="py-10 text-center text-sm text-faint">No cards yet. Add the first one above.</p>
        ) : (
          <ul className="mt-6 border-t border-edge">
            {cards.map((c) => (
              // Keyed by text too: editing a cloze card rewrites its siblings, and a row still
              // holding the old text would write it back on its next blur.
              <CardRow key={`${c.id}:${c.front}:${c.back}`} card={c} />
            ))}
          </ul>
        )}
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
    <li className="group grid grid-cols-[1fr_1fr_auto] items-center gap-3 border-b border-edge py-2">
      <input className="bg-transparent text-sm" value={front} onChange={(e) => setFront(e.target.value)} onBlur={save} aria-label="Front" />
      <input className="bg-transparent text-sm text-muted" value={back} onChange={(e) => setBack(e.target.value)} onBlur={save} aria-label="Back" />
      <div className="flex items-center gap-1">
        <span className="w-14 text-right text-xs text-faint">{due ? 'due' : `in ${card.interval_days}d`}</span>
        <button
          type="button"
          title="Delete card"
          aria-label="Delete card"
          className="flex h-7 w-7 items-center justify-center rounded-md text-faint opacity-0 transition-opacity hover:bg-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => void api.decks.removeCard(card.id).then(() => bumpData('decks'))}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  )
}
