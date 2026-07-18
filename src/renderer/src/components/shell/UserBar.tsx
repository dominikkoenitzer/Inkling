import { Settings, Play, Pause } from 'lucide-react'
import { useApp, localDayKey } from '@/stores/app'
import { useTimer, fmtClock } from '@/stores/timer'
import { isColorKey } from '@/lib/colors'
import { Inky } from '@/components/Inky'
import { IconBtn } from '@/components/ui'

/**
 * Discord-style user panel pinned to the bottom of the sidebar: Inky + streak on the
 * left, a live Pomodoro chip and settings on the right. The timer stays visible and
 * controllable from every tab, not just Study.
 */
export function UserBar(): React.JSX.Element {
  const app = useApp()
  const timer = useTimer()
  const active = app.notebooks.find((n) => n.id === app.activeNotebookId)
  const inkyColor = isColorKey(active?.color) ? active!.color : 'teal'
  const activeToday = app.streak.last_day === localDayKey()
  const midway = !timer.running && timer.secondsLeft > 0 && timer.secondsLeft < timer.totalSeconds
  const showChip = timer.running || midway

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-edge px-2 py-1.5">
      <button
        type="button"
        onClick={() => app.setTab('today')}
        title={
          app.streak.count > 0
            ? `Study streak: ${app.streak.count} day${app.streak.count === 1 ? '' : 's'}${activeToday ? ', active today!' : ''}`
            : 'Finish a focus session or review some flashcards to start a streak'
        }
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-hover"
      >
        <Inky pose={app.celebrating ? 'happy' : activeToday ? 'neutral' : 'sleepy'} color={inkyColor} size={32} />
        <span className="min-w-0 leading-tight">
          <span className={`block truncate text-xs font-bold ${activeToday ? '' : 'text-muted'}`}>
            {app.streak.count > 0 ? `${app.streak.count}-day streak ${activeToday ? '🔥' : ''}` : 'No streak yet'}
          </span>
          <span className="block truncate text-[11px] text-faint">
            {activeToday ? 'Active today ✓' : app.streak.count > 0 ? 'Study today to keep it' : 'Review or focus to start'}
          </span>
        </span>
      </button>

      {showChip && (
        <span
          className="pop-in flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-bold tabular-nums text-white"
          style={{ background: 'var(--accent)' }}
          title={timer.mode === 'break' ? 'Break' : (timer.linkedLabel ?? 'Focus session')}
          onClick={() => {
            app.setSelectedDeck(null)
            app.setTab('study')
          }}
        >
          {timer.mode === 'break' ? '☕ ' : ''}
          {fmtClock(timer.secondsLeft)}
          <IconBtn
            title={timer.running ? 'Pause' : 'Resume'}
            className="!h-5 !w-5 !text-white hover:!bg-white/20"
            onClick={(e) => {
              e.stopPropagation()
              timer.running ? timer.pause() : timer.resume()
            }}
          >
            {timer.running ? <Pause size={12} /> : <Play size={12} />}
          </IconBtn>
        </span>
      )}

      <IconBtn title="Settings (Ctrl+,)" onClick={() => app.setSettingsOpen(true)}>
        <Settings size={16} />
      </IconBtn>
    </div>
  )
}
