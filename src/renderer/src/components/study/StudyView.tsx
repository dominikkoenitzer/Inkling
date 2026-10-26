import { useEffect, useRef, useState } from 'react'
import { Trash2, Plus, ArrowLeft } from 'lucide-react'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { addCard, createDeck, loadCards, loadDecks, peekNote, removeCard, removeDeck, renameDeck, updateCard } from '@/lib/calls'
import { hasCloze } from '@shared/cloze'
import { storedTime } from '@shared/day'
import { Inky } from '@/components/Inky'
import { Button, Code, IconBtn, inputCls, titleFieldCls } from '@/components/ui'
import { editKey, ignoresShortcut, stepRows } from '@/lib/keys'
import { oneLine } from '@/lib/parse'
import { ReviewSession } from './ReviewSession'
import { useRows, type RowProps } from '@/lib/motion'
import type { Deck, Card } from '@shared/types'

export function StudyView(): React.JSX.Element {
  const selectedDeckId = useApp((s) => s.selectedDeckId)
  const reviewingDeckId = useApp((s) => s.reviewingDeckId)
  const today = useApp((s) => s.today)
  const version = useVersion('decks')
  const [decks, setDecks] = useState<Deck[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const creating = useRef(false)
  const newDeck = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let stale = false
    void loadDecks().then((d) => {
      if (stale) return
      if (d) setDecks(d)
      setFailed(!d)
    })
    return () => {
      stale = true
    }
  }, [version, today])

  // After a deck is deleted, focus goes to New deck once the list is back.
  const focusNew = useRef(false)
  useEffect(() => {
    if (!focusNew.current || !newDeck.current) return
    focusNew.current = false
    newDeck.current.focus()
  })

  if (decks === null) {
    if (!failed) return <div />
    return (
      <div className="h-full overflow-y-auto">
        <div className="motion-rise mx-auto max-w-[680px] px-10 pb-20 pt-14">
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">Flashcards</h1>
          <p className="mt-16 text-sm text-muted">Could not load the decks.</p>
        </div>
      </div>
    )
  }

  const reviewing = decks.find((d) => d.id === reviewingDeckId)
  if (reviewing) return <ReviewSession deck={reviewing} onDone={() => useApp.getState().reviewDeck(null)} />

  const selected = decks.find((d) => d.id === selectedDeckId)
  if (selected) return <DeckDetail key={selected.id} deck={selected} onDeleted={() => (focusNew.current = true)} />

  const create = async (): Promise<void> => {
    const n = name.trim()
    if (!n || creating.current) return
    creating.current = true
    try {
      const deck = await createDeck(n)
      if (!deck) return
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
      <div className="motion-rise mx-auto max-w-[680px] px-10 pb-20 pt-14">
        <div className="flex items-end justify-between gap-4">
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">Flashcards</h1>
          <Button ref={newDeck} onClick={() => setAdding(true)}>
            <Plus size={15} /> New deck
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted">Each card comes back right before you would forget it.</p>

        {adding && (
          <input
            autoFocus
            className={`${inputCls} motion-rise mt-8`}
            value={name}
            placeholder="Deck name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void create()
              if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                // The field goes away, so focus goes back to the button that opened it.
                newDeck.current?.focus()
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
            <p className="mt-1 max-w-md text-sm text-muted">
              Write a line like <Code>Term :: Definition</Code> in a note, then press Flashcards. Or press New deck.
            </p>
          </div>
        ) : (
          <ul className="mt-8 border-t border-edge" onKeyDown={stepRows}>
            {decks.map((d) => (
              <li key={d.id} data-row={d.id} className="flex items-center gap-1 border-b border-edge">
                <button
                  type="button"
                  onClick={() => useApp.getState().openDeck(d.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-3 text-left transition-colors hover:bg-hover"
                >
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
                    className="press shrink-0 rounded-md px-2.5 py-1 text-sm font-medium text-accent-text hover:bg-accent-soft"
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

function DeckDetail({ deck, onDeleted }: { deck: Deck; onDeleted: () => void }): React.JSX.Element {
  const version = useVersion('decks')
  // Null until the cards arrive, so a deck is never shown empty before then.
  const [cards, setCards] = useState<Card[] | null>(null)
  const [cardsFailed, setCardsFailed] = useState(false)
  const cardList = useRef<HTMLUListElement>(null)
  const frontRef = useRef<HTMLInputElement>(null)
  // A card that goes hands its focus to the one beside it, or to the new card's question.
  const cardRows = useRows(cards, (c) => c.id, cardList, frontRef)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [name, setName] = useState(deck.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The delete buttons swap in place; focus that was on them moves to what takes their place.
  const deleteBox = useRef<HTMLSpanElement>(null)
  const deleteFocus = useRef(false)
  const askDelete = (ask: boolean): void => {
    deleteFocus.current = !!deleteBox.current?.contains(document.activeElement)
    setConfirmDelete(ask)
  }
  useEffect(() => {
    if (!deleteFocus.current) return
    deleteFocus.current = false
    deleteBox.current?.querySelector('button')?.focus()
  }, [confirmDelete])

  useEffect(() => {
    let stale = false
    void loadCards(deck.id).then((c) => {
      if (stale) return
      if (c) setCards(c)
      setCardsFailed(!c)
    })
    return () => {
      stale = true
    }
  }, [deck.id, version])

  // A deleted note has nothing to open, so its link stays hidden.
  const notesVersion = useVersion('notes')
  const [noteExists, setNoteExists] = useState(false)
  useEffect(() => {
    if (deck.note_id === null) return
    let stale = false
    void peekNote(deck.note_id).then((n) => n !== undefined && !stale && setNoteExists(!!n && !n.deleted_at))
    return () => {
      stale = true
    }
  }, [deck.note_id, notesVersion])
  const adding = useRef(false)
  const backRef = useRef<HTMLInputElement>(null)

  // Esc goes back to the deck list, unless a field or a dialog has it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const app = useApp.getState()
      const overlayOpen = app.paletteOpen || app.settingsOpen || document.querySelector('[data-sheet]') !== null
      if (e.key === 'Escape' && !ignoresShortcut(e, overlayOpen)) app.openDeck(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const count = cards?.length ?? deck.card_count

  // A cloze front is a whole card on its own; the back is then an optional extra.
  const canAdd = !!front.trim() && (!!back.trim() || hasCloze(front))

  /** True once the card is in. */
  const add = async (): Promise<boolean> => {
    if (!canAdd || adding.current) return false
    adding.current = true
    try {
      if (!(await addCard(deck.id, front.trim(), back.trim()))) return false
      setFront('')
      setBack('')
      bumpData('decks')
      return true
    } finally {
      adding.current = false
    }
  }

  // Escape drops the typed name; the blur that follows then keeps the old one.
  const renameDropped = useRef(false)
  const rename = (): void => {
    const n = name.trim()
    if (renameDropped.current) {
      renameDropped.current = false
      setName(deck.name)
    } else if (n && n !== deck.name) void renameDeck(deck.id, n).then((done) => (done ? bumpData('decks') : setName(deck.name)))
    else setName(deck.name)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="motion-rise mx-auto max-w-[680px] px-10 pb-20 pt-10">
        <button
          type="button"
          onClick={() => useApp.getState().openDeck(null)}
          className="-ml-2 mb-6 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <ArrowLeft size={15} /> All decks
        </button>

        <textarea
          rows={1}
          value={name}
          onChange={(e) => setName(oneLine(e.target.value))}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || (e.key !== 'Enter' && e.key !== 'Escape')) return
            e.preventDefault()
            renameDropped.current = e.key === 'Escape'
            e.currentTarget.blur()
          }}
          aria-label="Deck name"
          className={`${titleFieldCls} -mx-1.5 rounded-md px-1.5 focus:bg-raised focus:ring-1 focus:ring-accent`}
        />
        <div className="mt-2 flex items-center gap-3 text-sm text-muted">
          <span>
            {count} card{count === 1 ? '' : 's'}
            {deck.due_count > 0 && ` · ${deck.due_count} due`}
          </span>
          <span className="ml-auto flex gap-1">
            {deck.due_count > 0 && (
              <Button variant="primary" onClick={() => useApp.getState().reviewDeck(deck.id)}>
                Review now
              </Button>
            )}
            <span ref={deleteBox} className="contents">
              {confirmDelete ? (
                <>
                  <Button variant="ghost" onClick={() => askDelete(false)}>
                    Keep it
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      void removeDeck(deck.id).then((done) => {
                        if (!done) return
                        bumpData('decks')
                        onDeleted()
                        useApp.getState().openDeck(null)
                      })
                    }
                  >
                    Delete deck and cards
                  </Button>
                </>
              ) : (
                <IconBtn title="Delete deck" onClick={() => askDelete(true)}>
                  <Trash2 size={15} />
                </IconBtn>
              )}
            </span>
          </span>
        </div>

        {deck.note_id !== null && cards?.some((c) => c.source_line !== null) && (
          <p className="mt-6 text-sm text-muted">
            These cards live in a note. Edit them there, then press Flashcards again.{' '}
            {noteExists && (
              <button
                type="button"
                onClick={() => useApp.getState().openNote(deck.note_id!)}
                className="font-medium text-accent-text underline-offset-2 hover:underline"
              >
                Open the note
              </button>
            )}
          </p>
        )}

        <div className="mt-8 grid grid-cols-[1fr_1fr_auto] gap-2">
          <input
            ref={frontRef}
            className={inputCls}
            placeholder="Question"
            aria-label="Front"
            value={front}
            onChange={(e) => setFront(e.target.value)}
            onKeyDown={(e) =>
              // A cloze is a whole card; anything else still needs its answer. Escape leaves the field.
              editKey(
                e,
                () => {
                  if (hasCloze(front) && !back.trim()) void add()
                  else if (front.trim()) backRef.current?.focus()
                },
                (el) => el.blur()
              )
            }
          />
          <input
            ref={backRef}
            className={inputCls}
            placeholder="Answer"
            aria-label="Back"
            value={back}
            onChange={(e) => setBack(e.target.value)}
            onKeyDown={(e) =>
              editKey(
                e,
                () => void add().then((added) => added && frontRef.current?.focus()),
                (el) => el.blur()
              )
            }
          />
          <Button variant="primary" onClick={() => void add()} disabled={!canAdd}>
            <Plus size={15} /> Add
          </Button>
        </div>
        <p className="mt-2 text-xs text-faint">
          Press Enter to go on. For a fill-in-the-blank card, write <Code>{'{{c1::word}}'}</Code> in the question.
        </p>

        {cards === null ? (
          cardsFailed && <p className="py-10 text-center text-sm text-faint">Could not load the cards.</p>
        ) : cardRows.rows?.length ? (
          <ul ref={cardList} className="mt-6 border-t border-edge" onAnimationEnd={cardRows.onAnimationEnd}>
            {cardRows.rows.map((r) => (
              <CardRow key={r.key} card={r.item} motion={cardRows.row(r)} />
            ))}
          </ul>
        ) : (
          <p className="py-10 text-center text-sm text-faint">No cards yet. Type a question and its answer above.</p>
        )}
      </div>
    </div>
  )
}

function CardRow({ card, motion }: { card: Card; motion: RowProps }): React.JSX.Element {
  const due = storedTime(card.next_review_date) <= new Date().getTime()
  // A card made from a note line belongs to that line: an edit here would be undone by the
  // next Flashcards press, so it is shown as text and edited in the note.
  if (card.source_line !== null) {
    return (
      <li {...motion} className="motion-row grid grid-cols-[1fr_1fr_auto] items-center gap-2 border-b border-edge py-1.5">
        <span className="min-w-0 truncate px-1.5 py-1 text-sm">{card.front}</span>
        <span className="min-w-0 truncate px-1.5 py-1 text-sm text-muted">{card.back}</span>
        <span className="w-14 pr-8 text-right text-xs text-faint">{due ? 'due' : `in ${card.interval_days}d`}</span>
      </li>
    )
  }
  return <EditableCardRow card={card} due={due} motion={motion} />
}

function EditableCardRow({ card, due, motion }: { card: Card; due: boolean; motion: RowProps }): React.JSX.Element {
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
      void updateCard(card.id, f, b).then((done) => {
        if (done) return bumpData('decks')
        // Not saved: the row shows what is stored again.
        setFront(card.front)
        setBack(card.back)
      })
    }
  }

  const field = 'min-w-0 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-hover focus:bg-raised focus:ring-1 focus:ring-accent'
  // Leaving the field saves; Escape drops the edit first, so the save puts the card's text back.
  const keys = (e: React.KeyboardEvent<HTMLInputElement>): void =>
    editKey(
      e,
      (el) => el.blur(),
      (el) => {
        dirty.current = false
        el.blur()
      }
    )

  return (
    <li {...motion} className="motion-row group grid grid-cols-[1fr_1fr_auto] items-center gap-2 border-b border-edge py-1.5">
      <input
        className={field}
        value={front}
        onChange={(e) => {
          dirty.current = true
          setFront(e.target.value)
        }}
        onBlur={save}
        onKeyDown={keys}
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
        onKeyDown={keys}
        aria-label="Back"
      />
      <div className="flex items-center gap-1">
        <span className="w-14 text-right text-xs text-faint">{due ? 'due' : `in ${card.interval_days}d`}</span>
        <button
          type="button"
          title="Delete card"
          aria-label="Delete card"
          className="flex h-7 w-7 items-center justify-center rounded-md text-faint opacity-0 transition-opacity hover:bg-hover hover:text-danger focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={() => void removeCard(card.id).then((done) => done && bumpData('decks'))}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  )
}
