import { Settings } from 'lucide-react'
import { useApp, localDayKey } from '@/stores/app'
import { isColorKey } from '@/lib/colors'
import { Inky } from '@/components/Inky'
import { IconBtn } from '@/components/ui'

/**
 * User panel pinned to the bottom of the sidebar: Inky + streak on the left, settings on the right.
 */
export function UserBar(): React.JSX.Element {
  const app = useApp()
  const active = app.notebooks.find((n) => n.id === app.activeNotebookId)
  const inkyColor = isColorKey(active?.color) ? active!.color : 'teal'
  const activeToday = app.streak.last_day === localDayKey()

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-edge bg-app px-2 py-1.5">
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
            {app.streak.count > 0 ? `${app.streak.count}-day streak` : 'No streak yet'}
          </span>
          <span className="block truncate text-[11px] text-faint">
            {activeToday ? 'Active today' : app.streak.count > 0 ? 'Study today to keep it' : 'Review or focus to start'}
          </span>
        </span>
      </button>

      <IconBtn title="Settings (Ctrl+,)" onClick={() => app.setSettingsOpen(true)}>
        <Settings size={16} />
      </IconBtn>
    </div>
  )
}
