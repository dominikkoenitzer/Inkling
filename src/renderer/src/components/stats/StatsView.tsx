import { useEffect, useMemo, useState } from 'react'
import { Flame, Target, Timer, Layers, TrendingUp } from 'lucide-react'
import { useVersion } from '@/stores/app'
import { ramp } from '@/lib/colors'
import { EmptyState } from '@/components/Inky'
import { Segmented } from '@/components/ui'
import { NotebookGlyph } from '@/components/NotebookGlyph'
import { hasGlyph, initials } from '@/lib/icons'
import { formatInterval } from '@shared/fsrs'
import type { ActivityDay, ForecastDay, Notebook, RatingBreakdown, StatsOverview, SubjectStat } from '@shared/types'

const api = window.inkling

type Window = '7' | '30' | '90'
const WINDOWS: Array<{ value: Window; label: string }> = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' }
]

/** Weeks of history the heatmap shows — a bit over six months, like a contribution graph. */
const HEATMAP_WEEKS = 27

export function StatsView({ notebooks }: { notebooks: Notebook[] }): React.JSX.Element {
  const version = useVersion('decks') + useVersion('focus')
  const [windowDays, setWindowDays] = useState<Window>('30')
  const [overview, setOverview] = useState<StatsOverview | null>(null)
  const [days, setDays] = useState<ActivityDay[]>([])
  const [forecast, setForecast] = useState<ForecastDay[]>([])
  const [ratings, setRatings] = useState<RatingBreakdown | null>(null)
  const [subjects, setSubjects] = useState<SubjectStat[]>([])

  useEffect(() => {
    const n = Number(windowDays)
    let alive = true
    void Promise.all([
      api.stats.overview(n),
      api.stats.activity(HEATMAP_WEEKS * 7),
      api.stats.forecast(14),
      api.stats.ratings(n),
      api.stats.subjects(n)
    ]).then(([o, a, f, r, s]) => {
      if (!alive) return
      setOverview(o)
      setDays(a)
      setForecast(f)
      setRatings(r)
      setSubjects(s)
    })
    return () => {
      alive = false
    }
  }, [windowDays, version])

  if (!overview) return <div className="p-6 text-sm text-muted">Reading your history…</div>

  // Nothing has ever been reviewed and no focus session has ever completed: there is no
  // progress to show yet, and a wall of zeroes would be worse than saying so plainly.
  if (overview.reviews_all_time === 0 && overview.focus_minutes === 0 && days.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Header windowDays={windowDays} onWindow={setWindowDays} />
        <div className="min-h-0 flex-1">
          <EmptyState
            pose="neutral"
            title="Your progress starts with the first card"
            hint="Review a deck or run a focus block and this page fills in: an activity map, your true retention, and what's coming due."
          />
        </div>
      </div>
    )
  }

  const hours = Math.floor(overview.focus_minutes / 60)
  const mins = overview.focus_minutes % 60

  return (
    <div className="flex h-full flex-col">
      <Header windowDays={windowDays} onWindow={setWindowDays} />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-4xl gap-5">
          <section className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              icon={<Layers size={14} />}
              label={`Reviews · ${overview.window_days}d`}
              value={overview.reviews.toLocaleString()}
              sub={`${overview.reviews_all_time.toLocaleString()} all time`}
            />
            <Tile
              icon={<Target size={14} />}
              label="True retention"
              value={overview.retention === null ? '—' : `${Math.round(overview.retention * 100)}%`}
              sub={overview.retention === null ? 'no cards were due yet' : 'recalled without a lapse'}
              accent
            />
            <Tile
              icon={<Timer size={14} />}
              label="Focused"
              value={hours > 0 ? `${hours}h ${mins}m` : `${mins}m`}
              sub={`${overview.active_days} day${overview.active_days === 1 ? '' : 's'} studied`}
            />
            <Tile
              icon={<Flame size={14} />}
              label="Streak"
              value={`${overview.current_streak}d`}
              sub={`best ${overview.longest_streak}d`}
            />
          </section>

          <Panel title="Activity" hint="Reviews and focus minutes, by day">
            <Heatmap days={days} weeks={HEATMAP_WEEKS} />
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Coming due" hint="Next 14 days">
              <Forecast days={forecast} />
            </Panel>
            <Panel title="How it went" hint={`Answers over ${overview.window_days} days`}>
              <Ratings ratings={ratings} />
              <MemorySplit overview={overview} />
            </Panel>
          </div>

          {subjects.length > 0 && (
            <Panel title="By subject" hint={`Last ${overview.window_days} days`}>
              <Subjects subjects={subjects} notebooks={notebooks} />
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}

function Header({ windowDays, onWindow }: { windowDays: Window; onWindow: (v: Window) => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-edge px-5 py-2.5">
      <h2 className="text-base font-bold">Progress</h2>
      <div className="ml-auto">
        <Segmented options={WINDOWS} value={windowDays} onChange={onWindow} />
      </div>
    </div>
  )
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="rounded-lg border border-edge bg-raised p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Tile({
  icon,
  label,
  value,
  sub,
  accent
}: {
  icon: React.JSX.Element
  label: string
  value: string
  sub: string
  accent?: boolean
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-edge bg-raised p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        <span style={accent ? { color: 'var(--accent-text)' } : undefined}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="text-xl font-bold tabular-nums" style={accent ? { color: 'var(--accent-text)' } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-faint">{sub}</div>
    </div>
  )
}

/* --------------------------------- Heatmap -------------------------------- */

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * A contribution-graph of study effort: one column per week, Monday at the top. Intensity
 * is a card-equivalent score so a long focus block reads as real work even on a day with
 * no reviews (one focus minute ≈ one review).
 */
function Heatmap({ days, weeks }: { days: ActivityDay[]; weeks: number }): React.JSX.Element {
  const { columns, max, monthLabels } = useMemo(() => {
    const byDay = new Map(days.map((d) => [d.day, d]))

    // Start on the Monday of the week containing (today - weeks + 1 weeks).
    const end = new Date()
    end.setHours(0, 0, 0, 0)
    const start = new Date(end)
    start.setDate(start.getDate() - (weeks * 7 - 1))
    const weekday = (start.getDay() + 6) % 7 // 0 = Monday
    start.setDate(start.getDate() - weekday)

    const cols: Array<Array<{ key: string; score: number; entry: ActivityDay | undefined; future: boolean }>> = []
    const labels: Array<{ col: number; text: string }> = []
    let peak = 0
    const cursor = new Date(start)
    for (let c = 0; c < weeks; c++) {
      const col: Array<{ key: string; score: number; entry: ActivityDay | undefined; future: boolean }> = []
      for (let r = 0; r < 7; r++) {
        const key = dayKey(cursor)
        const entry = byDay.get(key)
        const score = entry ? entry.reviews + entry.focus_minutes : 0
        if (score > peak) peak = score
        col.push({ key, score, entry, future: cursor > end })
        if (r === 0 && cursor.getDate() <= 7) {
          labels.push({ col: c, text: cursor.toLocaleString(undefined, { month: 'short' }) })
        }
        cursor.setDate(cursor.getDate() + 1)
      }
      cols.push(col)
    }
    return { columns: cols, max: peak, monthLabels: labels }
  }, [days, weeks])

  const accent = 'var(--accent)'
  const level = (score: number): { background: string; opacity?: number } => {
    if (score <= 0) return { background: 'var(--bg-hover)' }
    // Four steps against a square-root scale, so a single review is still visible next
    // to a marathon day instead of being washed out by it.
    const t = Math.sqrt(score / Math.max(max, 1))
    const step = t > 0.75 ? 1 : t > 0.5 ? 0.75 : t > 0.25 ? 0.5 : 0.3
    return { background: accent, opacity: step }
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="relative mb-1 h-3.5">
          {monthLabels.map((m) => (
            <span key={`${m.col}-${m.text}`} className="absolute text-[10px] text-faint" style={{ left: `${m.col * 14}px` }}>
              {m.text}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              {col.map((cell) => (
                <div
                  key={cell.key}
                  title={
                    cell.future
                      ? ''
                      : `${cell.key} · ${cell.entry?.reviews ?? 0} review${(cell.entry?.reviews ?? 0) === 1 ? '' : 's'}` +
                        `${cell.entry?.focus_minutes ? ` · ${cell.entry.focus_minutes} focus min` : ''}`
                  }
                  className="h-[11px] w-[11px] rounded-[2px]"
                  style={cell.future ? { background: 'transparent' } : level(cell.score)}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-faint">
          <span>Less</span>
          <span className="h-[11px] w-[11px] rounded-[2px]" style={{ background: 'var(--bg-hover)' }} />
          {[0.3, 0.5, 0.75, 1].map((o) => (
            <span key={o} className="h-[11px] w-[11px] rounded-[2px]" style={{ background: accent, opacity: o }} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------- Forecast -------------------------------- */

function Forecast({ days }: { days: ForecastDay[] }): React.JSX.Element {
  const max = Math.max(1, ...days.map((d) => d.due))
  const total = days.reduce((n, d) => n + d.due, 0)
  if (total === 0) {
    return <p className="py-4 text-center text-xs text-faint">Nothing scheduled in the next two weeks. Add cards to fill it in.</p>
  }
  return (
    <div>
      <div className="flex h-24 items-end gap-1">
        {days.map((d, i) => (
          <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.day} · ${d.due} due`}>
            <div
              className="w-full rounded-[3px] transition-all"
              style={{
                height: `${Math.max(d.due > 0 ? 4 : 2, (d.due / max) * 80)}px`,
                background: d.due > 0 ? 'var(--accent)' : 'var(--bg-hover)',
                opacity: i === 0 ? 1 : 0.75
              }}
            />
            <span className="text-[9px] tabular-nums text-faint">{i === 0 ? 'now' : new Date(`${d.day}T12:00:00`).getDate()}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">
        {total} card{total === 1 ? '' : 's'} due over the next 14 days
      </p>
    </div>
  )
}

/* --------------------------- Ratings & memory mix -------------------------- */

const RATING_ROWS: Array<{ key: keyof RatingBreakdown; label: string; color: string }> = [
  { key: 'again', label: 'Again', color: '#e06c75' },
  { key: 'hard', label: 'Hard', color: '#e0a34a' },
  { key: 'good', label: 'Good', color: 'var(--accent)' },
  { key: 'easy', label: 'Easy', color: '#6aa9e0' }
]

function Ratings({ ratings }: { ratings: RatingBreakdown | null }): React.JSX.Element {
  const total = ratings ? ratings.again + ratings.hard + ratings.good + ratings.easy : 0
  if (!ratings || total === 0) {
    return <p className="py-2 text-xs text-faint">No answers in this window yet.</p>
  }
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 overflow-hidden rounded-full">
        {RATING_ROWS.map((r) => (
          <div key={r.key} style={{ width: `${(ratings[r.key] / total) * 100}%`, background: r.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {RATING_ROWS.map((r) => (
          <span key={r.key} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
            {r.label}
            <span className="tabular-nums text-faint">{Math.round((ratings[r.key] / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function MemorySplit({ overview }: { overview: StatsOverview }): React.JSX.Element {
  if (overview.cards_total === 0) return <></>
  return (
    <div className="mt-4 border-t border-edge pt-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <TrendingUp size={12} style={{ color: 'var(--accent-text)' }} />
          <span className="font-medium text-ink">{overview.cards_total}</span> cards
        </span>
        <span>
          <span className="tabular-nums text-ink">{overview.cards_new}</span> new
        </span>
        <span>
          <span className="tabular-nums text-ink">{overview.cards_learning}</span> learning
        </span>
        <span>
          <span className="tabular-nums text-ink">{overview.cards_review}</span> in review
        </span>
        {overview.mean_stability !== null && (
          <span title="Average time until a card's recall chance falls to 90%">
            memory strength <span className="tabular-nums text-ink">{formatInterval(overview.mean_stability)}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/* -------------------------------- Subjects -------------------------------- */

function Subjects({ subjects, notebooks }: { subjects: SubjectStat[]; notebooks: Notebook[] }): React.JSX.Element {
  const byId = new Map(notebooks.map((n) => [n.id, n]))
  return (
    <div className="stagger space-y-1">
      {subjects.map((s) => {
        const nb = byId.get(s.notebook_id)
        if (!nb) return null
        const shades = ramp(nb.color)
        return (
          <div key={s.notebook_id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-hover">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white"
              style={{ background: shades[500] }}
            >
              {hasGlyph(nb.icon) ? <NotebookGlyph icon={nb.icon} size={13} /> : initials(nb.name)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{nb.name}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted">{s.reviews} reviews</span>
            <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted">
              {s.retention === null ? '—' : `${Math.round(s.retention * 100)}%`}
            </span>
            <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-faint">
              {s.focus_minutes > 0 ? `${s.focus_minutes}m` : '—'}
            </span>
            <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-faint">
              {s.cards_due > 0 ? `${s.cards_due} due` : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
