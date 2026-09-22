import { useEffect, useMemo, useState } from 'react'
import { Flame, Target, Timer, Layers } from 'lucide-react'
import { useVersion } from '@/stores/app'
import { EmptyState } from '@/components/Inky'
import type { ActivityDay, StatsOverview } from '@shared/types'

const api = window.inkling

/** Weeks of history the heatmap shows: a bit over six months, like a contribution graph. */
const HEATMAP_WEEKS = 27
/** The window the counts cover. Fixed: a switcher here was three ways to read the same week. */
const WINDOW_DAYS = 30

export function StatsView(): React.JSX.Element {
  const version = useVersion('decks') + useVersion('focus')
  const [overview, setOverview] = useState<StatsOverview | null>(null)
  const [days, setDays] = useState<ActivityDay[]>([])

  useEffect(() => {
    let alive = true
    void Promise.all([api.stats.overview(WINDOW_DAYS), api.stats.activity(HEATMAP_WEEKS * 7)]).then(([o, a]) => {
      if (!alive) return
      setOverview(o)
      setDays(a)
    })
    return () => {
      alive = false
    }
  }, [version])

  if (!overview) return <div className="p-6 text-sm text-muted">Reading your history…</div>

  // Nothing has ever been reviewed and no focus session has ever completed: there is no
  // progress to show yet, and a wall of zeroes would be worse than saying so plainly.
  if (overview.reviews_all_time === 0 && overview.focus_minutes === 0 && days.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Header />
        <div className="min-h-0 flex-1">
          <EmptyState
            pose="neutral"
            title="Your progress starts with the first card"
            hint="Review a deck or run a focus block and this page fills in: your activity and how much you are holding on to."
          />
        </div>
      </div>
    )
  }

  const hours = Math.floor(overview.focus_minutes / 60)
  const mins = overview.focus_minutes % 60

  return (
    <div className="flex h-full flex-col">
      <Header />
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
              value={overview.retention === null ? '-' : `${Math.round(overview.retention * 100)}%`}
              sub={overview.retention === null ? 'no cards were due yet' : 'recalled without a lapse'}
              accent
            />
            <Tile
              icon={<Timer size={14} />}
              label="Focused"
              value={hours > 0 ? `${hours}h ${mins}m` : `${mins}m`}
              sub={`${overview.active_days} day${overview.active_days === 1 ? '' : 's'} studied`}
            />
            <Tile icon={<Flame size={14} />} label="Streak" value={`${overview.current_streak}d`} sub={`best ${overview.longest_streak}d`} />
          </section>

          <section className="rounded-lg border border-edge bg-raised p-4">
            <div className="mb-3 flex items-baseline gap-2">
              <h3 className="text-[13px] font-semibold">Activity</h3>
              <span className="text-[11px] text-faint">Reviews and focus minutes, by day</span>
            </div>
            <Heatmap days={days} weeks={HEATMAP_WEEKS} />
          </section>
        </div>
      </div>
    </div>
  )
}

function Header(): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-edge px-5 py-2.5">
      <h2 className="text-base font-bold">Progress</h2>
    </div>
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
 * Contribution graph of study effort, one column per week, Monday at the top. Intensity
 * counts one focus minute as one review, so a long block still shows on a no-review day.
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
