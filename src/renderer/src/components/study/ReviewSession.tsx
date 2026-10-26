import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useApp, bumpData } from '@/stores/app'
import { Inky } from '@/components/Inky'
import { Button, IconBtn, Kbd } from '@/components/ui'
import { endsReview, ignoresShortcut } from '@/lib/keys'
import { loadDueCards, reviewCard } from '@/lib/calls'
import { formatInterval, previewIntervals, RELEARN_MINUTES, type Rating } from '@shared/fsrs'
import { renderCloze } from '@shared/cloze'
import type { Deck, Card, ReviewGrade } from '@shared/types'

const GRADES: Array<{ grade: ReviewGrade; label: string; rating: Rating; tone: string }> = [
  { grade: 'again', label: 'Again', rating: 1, tone: 'text-danger' },
  { grade: 'hard', label: 'Hard', rating: 2, tone: 'text-ink' },
  { grade: 'good', label: 'Good', rating: 3, tone: 'text-accent-text' },
  { grade: 'easy', label: 'Easy', rating: 4, tone: 'text-accent-text' }
]

export function ReviewSession({ deck, onDone }: { deck: Deck; onDone: () => void }): React.JSX.Element {
  const [queue, setQueue] = useState<Card[]>([])
  const [index, setIndex] = useState(0)
  const [showBack, setShowBack] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const gradingRef = useRef(false)
  // The position last graded: a second key press before the next card renders must not grade again.
  const gradedAt = useRef(-1)
  const fsrsParams = useApp((s) => s.fsrsParams)

  // Leaving by any route (sidebar, palette, a new note) still refreshes the due counts.
  useEffect(() => () => bumpData('decks'), [])

  useEffect(() => {
    void loadDueCards(deck.id).then((cards) => {
      if (!cards) return setFailed(true)
      setQueue(cards)
      setLoaded(true)
    })
  }, [deck.id])

  const finish = (): void => {
    bumpData('decks')
    onDone()
  }

  const grade = async (g: ReviewGrade): Promise<void> => {
    if (gradingRef.current) return // ignore a second grade while the review IPC is in flight
    const card = queue[index]
    if (!card || gradedAt.current === index) return // nothing to grade, or already graded
    gradingRef.current = true
    try {
      const updated = await reviewCard(card.id, g)
      if (!updated) return // not saved: the card stays up to be graded again
      gradedAt.current = index
      setReviewed((r) => r + 1)
      setShowBack(false)
      if (g === 'again') {
        // Struggled: FSRS puts it back inside the session, so requeue it at the end,
        // with the memory state it just got, or its second showing would preview stale
        // intervals.
        setQueue((q) => [...q, updated ?? card])
      }
      setIndex((i) => i + 1)
    } finally {
      gradingRef.current = false
    }
  }

  // keyboard: space reveals, 1-4 grade
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Typing "Chapter 2" in a field, or Esc in the palette, must not reveal, grade or end.
      const app = useApp.getState()
      const overlayOpen = app.paletteOpen || app.settingsOpen || document.querySelector('[data-sheet]') !== null
      if (ignoresShortcut(e, overlayOpen) || e.repeat) return
      if (!queue[index]) {
        // The last screen: Esc or Enter ends it; Space and the grades do nothing here.
        if (endsReview(e)) {
          e.preventDefault()
          finish()
        }
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        setShowBack(true)
      }
      if (showBack && ['1', '2', '3', '4'].includes(e.key)) {
        void grade(GRADES[Number(e.key) - 1].grade)
      }
      if (e.key === 'Escape') finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBack, index, queue])

  const card = queue[index]
  const done = loaded && (queue.length === 0 || index >= queue.length)

  // FSRS runs the same maths in the main process when the answer lands; running it here
  // too lets each button show the interval it would buy, without a round-trip per card.
  const intervals =
    card && showBack
      ? previewIntervals(
          { state: card.state, stability: card.stability, difficulty: card.difficulty, lastReview: card.last_review },
          new Date(),
          fsrsParams
        )
      : null

  return (
    <div className="flex h-full flex-col">
      {/* Same column as every other page, so the deck name sits where titles do. */}
      <div className="motion-rise mx-auto w-full max-w-[680px] px-10 pt-8">
        <div className="flex items-center gap-3">
          <h2 className="truncate text-sm font-medium text-muted">{deck.name}</h2>
          <span className="text-xs tabular-nums text-faint">
            {Math.min(index, queue.length)} of {queue.length}
          </span>
          <div className="ml-auto">
            <IconBtn title="End session (Esc)" onClick={finish}>
              <X size={16} />
            </IconBtn>
          </div>
        </div>
        <div className="mt-2 h-0.5 rounded-full bg-hover">
          <div
            className="motion-fill h-full rounded-full"
            style={{ width: `${queue.length ? (Math.min(index, queue.length) / queue.length) * 100 : 0}%`, background: 'var(--accent)' }}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-8">
        {done ? (
          <div className="motion-rise flex flex-col items-center gap-2 text-center">
            <Inky size={44} className="mb-2" />
            <div className="text-[15px] font-medium">{reviewed > 0 ? 'All caught up.' : 'Nothing due in this deck.'}</div>
            <div className="max-w-sm text-sm text-muted">
              {reviewed > 0
                ? `You reviewed ${reviewed} card${reviewed === 1 ? '' : 's'}. Cards you struggled with will come back sooner.`
                : 'Come back when cards are due. Spaced repetition works best that way.'}
            </div>
            <div className="mt-3">
              <Button variant="primary" onClick={finish}>
                Done
              </Button>
            </div>
          </div>
        ) : card ? (
          <>
            <div
              className="motion-rise flex min-h-[240px] w-full max-w-xl cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border border-edge bg-raised p-10 text-center"
              onClick={() => setShowBack(true)}
              key={`${card.id}-${index}`}
            >
              <div className="font-display whitespace-pre-line text-xl font-medium">
                {card.cloze > 0 ? <ClozeText text={card.front} n={card.cloze} reveal={showBack} /> : card.front}
              </div>
              {showBack ? (
                // A cloze card's answer is revealed in place; the back only holds an optional extra.
                card.back && (
                  <>
                    <div className="motion-rise h-px w-16 bg-edge" />
                    <div className="motion-rise whitespace-pre-line text-base text-muted">{card.back}</div>
                  </>
                )
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-faint">
                  Click or press <Kbd>Space</Kbd> to see the answer
                </div>
              )}
            </div>
            {showBack && (
              <div className="motion-rise flex gap-2">
                {GRADES.map((g, i) => (
                  <button
                    key={g.grade}
                    type="button"
                    onClick={() => void grade(g.grade)}
                    className={`min-w-[88px] press rounded-md border border-edge bg-raised px-4 py-2 text-sm font-medium hover:bg-hover ${g.tone}`}
                  >
                    <span className="flex items-center justify-center gap-2">
                      {g.label}
                      <Kbd className="h-4 min-w-4 px-1 text-[11px]">{i + 1}</Kbd>
                    </span>
                    {/* What each answer would schedule, so the choice shows its cost. */}
                    <div className="text-xs font-normal text-faint">
                      {intervals ? (intervals[g.rating] === 0 ? `${RELEARN_MINUTES}m` : formatInterval(intervals[g.rating])) : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="motion-rise text-muted">{failed ? 'Could not load the cards.' : 'Loading cards...'}</div>
        )}
      </div>
    </div>
  )
}

/** A cloze card's front, with the asked span blanked, or shown in the accent once revealed. */
function ClozeText({ text, n, reveal }: { text: string; n: number; reveal: boolean }): React.JSX.Element {
  return (
    <>
      {renderCloze(text, n, reveal).map((part, i) =>
        part.kind === 'plain' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <span key={i} className={part.kind === 'blank' ? 'text-faint' : undefined} style={part.kind === 'answer' ? { color: 'var(--accent-text)' } : undefined}>
            {part.text}
          </span>
        )
      )}
    </>
  )
}
