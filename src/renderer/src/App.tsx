import { useEffect } from 'react'
import { Search } from 'lucide-react'
import { useApp, watchDay } from '@/stores/app'
import { Sidebar } from '@/components/shell/Sidebar'
import { MainPane } from '@/components/shell/MainPane'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { SettingsModal } from '@/components/shell/SettingsModal'
import { LogoMark } from '@/components/Inky'
import { Toaster } from '@/components/ui'

const api = window.inkling

export default function App(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const theme = useApp((s) => s.theme)
  const paletteOpen = useApp((s) => s.paletteOpen)
  const settingsOpen = useApp((s) => s.settingsOpen)

  useEffect(() => {
    void useApp.getState().init()
    ;(window as unknown as Record<string, unknown>).__app = useApp // for headless checks
  }, [])

  // Roll "today" over at midnight and when the window comes back.
  useEffect(() => watchDay(), [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    void api.app.setTitlebar(theme)
  }, [theme])

  // Ctrl+K search, Ctrl+N new note, Ctrl+, settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      const app = useApp.getState()
      if (key === 'k') {
        e.preventDefault()
        app.setPaletteOpen(!app.paletteOpen)
      } else if (key === 'n') {
        e.preventDefault()
        void app.newNote()
      } else if (key === ',') {
        e.preventDefault()
        app.setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) return <div className="h-full bg-app" />

  return (
    <div className="flex h-full flex-col bg-app text-ink">
      {/* Draggable title bar; the window buttons sit over its right end. */}
      <header className="titlebar-drag flex h-11 shrink-0 items-center border-b border-edge">
        <div className="flex h-full shrink-0 items-center gap-2 pl-4" style={{ width: 'var(--sidebar-w)' }}>
          <LogoMark size={18} />
          <span className="text-sm font-semibold tracking-tight">Inkling</span>
        </div>
        <button
          type="button"
          onClick={() => useApp.getState().setPaletteOpen(true)}
          className="no-drag ml-4 flex h-8 w-80 items-center gap-2 rounded-md bg-hover px-3 text-sm text-faint transition-colors hover:text-muted"
        >
          <Search size={15} />
          Search
          <span className="ml-auto text-xs">Ctrl K</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 bg-sunken">
          <MainPane />
        </main>
      </div>

      {paletteOpen && <CommandPalette />}
      {settingsOpen && <SettingsModal />}
      <Toaster />
    </div>
  )
}
