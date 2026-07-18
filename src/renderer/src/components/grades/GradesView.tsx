import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useApp, useVersion, bumpData } from '@/stores/app'
import { isColorKey } from '@/lib/colors'
import { EmptyState } from '@/components/Inky'
import { Button, IconBtn, Segmented } from '@/components/ui'
import { weightedPercentage, weightedSwissGrade, swissItemGrade, letterGrade, gpaPoints, swissRound, swissPass, GRADING_SYSTEM_OPTIONS } from '@shared/grades'
import type { Notebook, Grade } from '@shared/types'

const api = window.inkling

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1))
// local field class WITHOUT w-full so the fixed widths below actually apply
const fieldCls = 'rounded-lg border border-edge bg-raised px-3 py-1.5 text-sm text-ink placeholder:text-faint focus:border-transparent'

export function GradesView({ notebook }: { notebook: Notebook }): React.JSX.Element {
  const { gradingSystem, setGradingSystem } = useApp()
  const version = useVersion('grades')
  const [grades, setGrades] = useState<Grade[]>([])
  const [title, setTitle] = useState('')
  const [score, setScore] = useState('')
  const [max, setMax] = useState('100')
  const [weight, setWeight] = useState('1')
  const [adding, setAdding] = useState(false)
  const swiss = gradingSystem === 'swiss'

  useEffect(() => {
    void api.grades.list(notebook.id).then(setGrades)
  }, [notebook.id, version])

  const pct = weightedPercentage(grades)
  // round once so the shown %, letter, and GPA can't disagree at a grade cutoff
  const shownPct = pct === null ? null : Math.round(pct * 10) / 10
  const avgGrade = weightedSwissGrade(grades)
  const shownSwiss = avgGrade === null ? null : swissRound(avgGrade)

  const add = async (): Promise<void> => {
    const s = parseFloat(score)
    const w = parseFloat(weight)
    if (!title.trim() || !Number.isFinite(s)) return
    if (swiss) {
      // Swiss entries ARE grades. Out-of-band input is a typo, not a grade: refuse it
      // rather than silently clamping a mistyped 45 into a perfect 6.
      if (s < 1 || s > 6) return
      // max is fixed at 6 so swissItemGrade can tell these rows apart from points entries
      await api.grades.create({
        notebook_id: notebook.id,
        title: title.trim(),
        score: s,
        max: 6,
        weight: Number.isFinite(w) && w > 0 ? w : 1
      })
    } else {
      const m = parseFloat(max)
      await api.grades.create({
        notebook_id: notebook.id,
        title: title.trim(),
        score: s,
        max: Number.isFinite(m) && m > 0 ? m : 100,
        weight: Number.isFinite(w) && w > 0 ? w : 1
      })
    }
    setTitle('')
    setScore('')
    setMax('100')
    setWeight('1')
    bumpData('grades')
  }

  const onEnter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') void add()
    if (e.key === 'Escape') setAdding(false)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge px-5 py-2.5">
        <h2 className="text-base font-bold">Grades · {notebook.name}</h2>
        <div className="ml-auto flex items-center gap-5">
          {swiss && shownSwiss !== null && (
            <>
              <Stat label="Ø Grade" value={shownSwiss.toFixed(1)} accent />
              <Stat label="Status" value={swissPass(shownSwiss) ? 'Passing ✓' : 'Below 4'} />
            </>
          )}
          {gradingSystem === 'us' && shownPct !== null && (
            <>
              <Stat label="Grade" value={`${shownPct.toFixed(1)}%`} />
              <Stat label="Letter" value={letterGrade(shownPct)} accent />
              <Stat label="GPA" value={gpaPoints(shownPct).toFixed(1)} />
            </>
          )}
          {gradingSystem === 'percent' && shownPct !== null && <Stat label="Average" value={`${shownPct.toFixed(1)}%`} accent />}
          <Segmented options={GRADING_SYSTEM_OPTIONS} value={gradingSystem} onChange={setGradingSystem} />
        </div>
      </div>

      <div className="border-b border-edge px-5 py-2">
        <div className="mx-auto max-w-2xl">
          {!adding ? (
            <Button variant="ghost" onClick={() => setAdding(true)}>
              <Plus size={14} /> Add assessment
            </Button>
          ) : (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            className={`${fieldCls} min-w-0 flex-1`}
            placeholder="Assessment (e.g. Midterm)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onEnter}
          />
          {swiss ? (
            <input
              className={`${fieldCls} w-20 px-2 text-center`}
              placeholder="Grade"
              title="Grade from 1 to 6, where 6 is best"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              onKeyDown={onEnter}
            />
          ) : (
            <>
              <input className={`${fieldCls} w-16 px-2 text-center`} placeholder="Score" value={score} onChange={(e) => setScore(e.target.value)} onKeyDown={onEnter} />
              <span className="text-faint">/</span>
              <input className={`${fieldCls} w-16 px-2 text-center`} placeholder="Max" value={max} onChange={(e) => setMax(e.target.value)} onKeyDown={onEnter} />
            </>
          )}
          <span className="text-xs text-faint" title="weight">×</span>
          <input className={`${fieldCls} w-12 px-2 text-center`} title="Weight" value={weight} onChange={(e) => setWeight(e.target.value)} onKeyDown={onEnter} />
          <Button variant="primary" onClick={() => void add()}>
            <Plus size={14} /> Add
          </Button>
          <Button variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-3">
        {grades.length === 0 ? (
          <EmptyState
            pose="neutral"
            color={isColorKey(notebook.color) ? notebook.color : 'teal'}
            title="No grades yet"
            hint={
              swiss
                ? 'Add an assessment above. Inkling keeps your weighted average on the 1–6 scale.'
                : 'Add an assessment above. Inkling keeps a weighted average for this subject.'
            }
          />
        ) : (
          <div className="stagger mx-auto max-w-2xl">
            {grades.map((g) => {
              const p = g.max > 0 ? (g.score / g.max) * 100 : 0
              const sg = swissItemGrade(g)
              return (
                <div key={g.id} className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-hover">
                  <span className="min-w-0 flex-1 truncate text-sm">{g.title}</span>
                  {swiss ? (
                    <>
                      {g.max !== 6 && (
                        <span className="tabular-nums text-sm text-muted">
                          {fmt(g.score)} / {fmt(g.max)}
                        </span>
                      )}
                      <span
                        className="w-12 text-right text-sm font-semibold tabular-nums"
                        style={{ color: sg !== null && swissPass(sg) ? 'var(--accent-text)' : '#e5484d' }}
                      >
                        {sg === null ? '·' : swissRound(sg).toFixed(1)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="tabular-nums text-sm text-muted">
                        {fmt(g.score)} / {fmt(g.max)}
                      </span>
                      <span className="w-12 text-right text-sm font-semibold tabular-nums" style={{ color: 'var(--accent-text)' }}>
                        {gradingSystem === 'us' ? letterGrade(p) : `${p.toFixed(0)}%`}
                      </span>
                    </>
                  )}
                  {g.weight !== 1 && <span className="rounded-full bg-raised px-1.5 py-0.5 text-[11px] text-muted">×{fmt(g.weight)}</span>}
                  <IconBtn
                    title="Remove"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => {
                      void api.grades.remove(g.id).then(() => bumpData('grades'))
                    }}
                  >
                    <Trash2 size={14} />
                  </IconBtn>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }): React.JSX.Element {
  return (
    <div className="text-right leading-tight">
      <div className="text-[11px] uppercase tracking-wider text-faint">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={accent ? { color: 'var(--accent-text)' } : undefined}>
        {value}
      </div>
    </div>
  )
}
