import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useApp, bumpData } from '@/stores/app'
import { Inky } from '@/components/Inky'
import { Button, IconBtn } from '@/components/ui'
import type { Deck, Card, ReviewGrade } from '@shared/types'

const api = window.inkling

const GRADES: Array<{ grade: ReviewGrade; label: string; hint: string; tone: string }> = [
  { grade: 'again', label: 'Again', hint: 'soon', tone: '#d85a30' },
  { grade: 'hard', label: 'Hard', hint: '', tone: '#c98b32' },
  { grade: 'good', label: 'Good', hint: '', tone: '#1d9e75' },
  { grade: 'easy', label: 'Easy', hint: '', tone: '#3db58b' }
]

export function ReviewSession({ deck, onDone }: { deck: Deck; onDone: () => void }): React.JSX.Element {
  const [queue, setQueue] = useState<Card[]>([])
  const [index, setIndex] = useState(0)
  const [showBack, setShowBack] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const gradingRef = useRef(false)

  useEffect(() => {
    void api.decks.dueCards(deck.id).then((cards) => {
      setQueue(cards)
      setLoaded(true)
    })
  }, [deck.id])

  const finish = (): void => {
    if (reviewed > 0) {
      void useApp.getState().bumpStreak()
      useApp.getState().celebrate()
    }
    bumpData('decks')
    onDone()
  }

  const grade = async (g: ReviewGrade): Promise<void> => {
    if (gradingRef.current) return // ignore a second grade while the review IPC is in flight
    const card = queue[index]
    if (!card) return // nothing to grade (e.g. keypress on the completion screen)
    gradingRef.current = true
    try {
      await api.decks.review(card.id, g)
      setReviewed((r) => r + 1)
      setShowBack(false)
      if (g === 'again') {
        // struggled — bring it back at the end of this session (§3: SM-2)
        setQueue((q) => [...q, card])
      }
      setIndex((i) => i + 1)
    } finally {
      gradingRef.current = false
    }
  }

  // keyboard: space reveals, 1-4 grade
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!queue[index]) {
        // completion / empty screen — only Esc is live; ignore Space/number grades
        if (e.key === 'Escape') finish()
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge px-5 py-2.5">
        <h2 className="text-[15px] font-bold">Reviewing · {deck.name}</h2>
        <span className="text-xs text-muted">
          {Math.min(index, queue.length)}/{queue.length}
        </span>
        <div className="ml-auto">
          <IconBtn title="End session (Esc)" onClick={finish}>
            <X size={16} />
          </IconBtn>
        </div>
      </div>

      <div className="h-1 bg-panel">
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${queue.length ? (Math.min(index, queue.length) / queue.length) * 100 : 0}%`, background: 'var(--accent)' }}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-8">
        {done ? (
          <div className="flex flex-col items-center gap-3 text-center fade-up">
            <Inky pose="happy" size={110} />
            <div className="text-xl font-bold">{reviewed > 0 ? 'All caught up — nice work!' : 'Nothing due in this deck'}</div>
            <div className="max-w-sm text-muted">
              {reviewed > 0
                ? `You reviewed ${reviewed} card${reviewed === 1 ? '' : 's'}. Cards you struggled with will come back sooner.`
                : 'Come back when cards are due — spaced repetition works best that way.'}
            </div>
            <Button variant="primary" onClick={finish}>
              Done
            </Button>
          </div>
        ) : card ? (
          <>
            <div
              className="pop-in flex min-h-[220px] w-full max-w-xl cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border border-edge bg-panel p-8 text-center shadow-lg"
              onClick={() => setShowBack(true)}
              key={`${card.id}-${index}`}
            >
              <div className="text-lg font-semibold">{card.front}</div>
              {showBack ? (
                <>
                  <div className="h-px w-24" style={{ background: 'var(--accent)' }} />
                  <div className="text-base text-muted">{card.back}</div>
                </>
              ) : (
                <div className="text-xs text-faint">click or press Space to reveal</div>
              )}
            </div>
            {showBack && (
              <div className="flex gap-2 fade-up">
                {GRADES.map((g, i) => (
                  <button
                    key={g.grade}
                    type="button"
                    onClick={() => void grade(g.grade)}
                    className="min-w-[86px] rounded-xl border border-edge bg-panel px-4 py-2.5 text-sm font-semibold transition-transform hover:scale-105"
                    style={{ color: g.tone }}
                  >
                    {g.label}
                    <div className="text-[10px] font-normal text-faint">{i + 1}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-muted">Loading cards…</div>
        )}
      </div>
    </div>
  )
}
