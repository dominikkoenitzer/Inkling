import { Settings } from 'lucide-react'
import { useApp } from '@/stores/app'
import { isColorKey } from '@/lib/colors'
import { Inky } from '@/components/Inky'
import { IconBtn } from '@/components/ui'

/**
 * User panel pinned to the bottom of the sidebar: Inky on the left, settings on the right.
 */
export function UserBar(): React.JSX.Element {
  const app = useApp()
  const active = app.notebooks.find((n) => n.id === app.activeNotebookId)
  const inkyColor = isColorKey(active?.color) ? active!.color : 'teal'

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-edge bg-app px-2 py-1.5">
      <button
        type="button"
        onClick={() => app.setTab('today')}
        title="Today"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-hover"
      >
        <Inky color={inkyColor} size={32} />
      </button>

      <IconBtn title="Settings (Ctrl+,)" onClick={() => app.setSettingsOpen(true)}>
        <Settings size={16} />
      </IconBtn>
    </div>
  )
}
