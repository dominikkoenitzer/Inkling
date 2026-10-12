import { useEffect, useRef, useState } from 'react'
import { Trash2, Plus, ArrowLeft, Layers } from 'lucide-react'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { hasCloze } from '@shared/cloze'
import { Inky } from '@/components/Inky'
import { Button, IconBtn, inputCls } from '@/components/ui'
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
  const creating = useRef(false)

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
  if (selected) return <DeckDetail key={selected.id} deck={selected} />

  const create = async (): Promise<void> => {
    const n = name.trim()
    if (!n || creating.current) return
    creating.current = true
    try {
      const home = useApp.getState().homeNotebookId ?? (await api.notebooks.home())
      const deck = await api.decks.create(home, n)
      bumpData('decks')
      setAdding(false)
      setName('')
      useApp.getState().openDeck(deck.id)
    } finally {
      creating.current = false
    }
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
              if (e.key === 'Escape') {
                setAdding(false)
                setName('')
              }
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
            {decks.map((d) => (
              <li key={d.id} className="flex items-center gap-1 border-b border-edge">
                <button
                  type="button"
                  onClick={() => useApp.getState().openDeck(d.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-3 text-left transition-colors hover:bg-hover"
                >
                  <Layers size={16} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{d.name}</span>
                  <span className="shrink-0 pr-2 text-xs text-faint">
                    {d.card_count} card{d.card_count === 1 ? '' : 's'}
                    {d.due_count > 0 && <span className="text-accent-text"> · {d.due_count} due</span>}
                  </span>
                </button>
                {d.due_count > 0 && (
                  <button
                    type="button"
                    onClick={() => useApp.getState().reviewDeck(d.id)}
                    className="shrink-0 rounded-md px-2.5 py-1 text-sm font-medium text-accent-text transition-colors hover:bg-accent-soft"
                  >
                    Review
                  </button>
                )}
              </li>
            ))}
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
    let stale = false
    void api.decks.cards(deck.id).then((c) => !stale && setCards(c))
    return () => {
      stale = true
    }
  }, [deck.id, version])
  const adding = useRef(false)

  // A cloze front is a whole card on its own; the back is then an optional extra.
  const canAdd = !!front.trim() && (!!back.trim() || hasCloze(front))

  const add = async (): Promise<void> => {
    if (!canAdd || adding.current) return
    adding.current = true
    try {
      await api.decks.addCard(deck.id, front.trim(), back.trim())
      setFront('')
      setBack('')
      bumpData('decks')
    } finally {
      adding.current = false
    }
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

        {deck.note_id !== null && cards.some((c) => c.source_line !== null) && (
          <p className="mt-6 text-sm text-muted">
            Cards from a note are edited in that note, so the next Flashcards press keeps your change.{' '}
            <button
              type="button"
              onClick={() => useApp.getState().openNote(deck.note_id!)}
              className="font-medium text-accent-text underline-offset-2 hover:underline"
            >
              Open the note
            </button>
          </p>
        )}

        <div className="mt-8 grid grid-cols-[1fr_1fr_auto] gap-2">
          <input className={inputCls} placeholder="Front, or a {{c1::cloze}}" value={front} onChange={(e) => setFront(e.target.value)} />
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
              <CardRow key={c.id} card={c} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function CardRow({ card }: { card: Card }): React.JSX.Element {
  const due = new Date(card.next_review_date) <= new Date()
  // A card made from a note line belongs to that line: an edit here would be undone by the
  // next Flashcards press, so it is shown as text and edited in the note.
  if (card.source_line !== null) {
    return (
      <li className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 border-b border-edge py-1.5">
        <span className="min-w-0 truncate px-1.5 py-1 text-sm">{card.front}</span>
        <span className="min-w-0 truncate px-1.5 py-1 text-sm text-muted">{card.back}</span>
        <span className="w-14 pr-8 text-right text-xs text-faint">{due ? 'due' : `in ${card.interval_days}d`}</span>
      </li>
    )
  }
  return <EditableCardRow card={card} due={due} />
}

function EditableCardRow({ card, due }: { card: Card; due: boolean }): React.JSX.Element {
  const [front, setFront] = useState(card.front)
  const [back, setBack] = useState(card.back)
  const dirty = useRef(false)

  // Editing a cloze card rewrites its siblings: take their new text unless this row has
  // changes of its own that are not saved yet.
  useEffect(() => {
    if (dirty.current) return
    setFront(card.front)
    setBack(card.back)
  }, [card.front, card.back])

  const save = (): void => {
    if (!dirty.current) {
      setFront(card.front)
      setBack(card.back)
      return
    }
    dirty.current = false
    const f = front.trim()
    const b = back.trim()
    // Same rule as adding a card: a front, and a back unless the front is a cloze.
    if (!f || (!b && !hasCloze(f))) {
      setFront(card.front)
      setBack(card.back)
      return
    }
    if (f !== card.front || b !== card.back) {
      void api.decks.updateCard(card.id, f, b).then(() => bumpData('decks'))
    }
  }

  const field = 'min-w-0 rounded px-1.5 py-1 text-sm transition-colors hover:bg-hover focus:bg-hover'

  return (
    <li className="group grid grid-cols-[1fr_1fr_auto] items-center gap-2 border-b border-edge py-1.5">
      <input
        className={field}
        value={front}
        onChange={(e) => {
          dirty.current = true
          setFront(e.target.value)
        }}
        onBlur={save}
        aria-label="Front"
      />
      <input
        className={`${field} text-muted`}
        value={back}
        onChange={(e) => {
          dirty.current = true
          setBack(e.target.value)
        }}
        onBlur={save}
        aria-label="Back"
      />
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
