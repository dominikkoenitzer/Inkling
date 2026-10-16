import { useEffect, useLayoutEffect } from 'react'
import { Search } from 'lucide-react'
import { useApp, watchDay, watchFocus, bumpData } from '@/stores/app'
import { Sidebar } from '@/components/shell/Sidebar'
import { MainPane } from '@/components/shell/MainPane'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { SettingsModal } from '@/components/shell/SettingsModal'
import { ShortcutsModal } from '@/components/shell/ShortcutsModal'
import { LogoMark } from '@/components/Inky'
import { Toaster } from '@/components/ui'

const api = window.inkling

export default function App(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const failed = useApp((s) => s.failed)
  const theme = useApp((s) => s.theme)
  const paletteOpen = useApp((s) => s.paletteOpen)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const shortcutsOpen = useApp((s) => s.shortcutsOpen)

  useEffect(() => {
    void useApp.getState().init()
    ;(window as unknown as Record<string, unknown>).__app = useApp // for headless checks
  }, [])

  // Roll "today" over at midnight and when the window comes back.
  useEffect(() => watchDay(), [])

  // Pick up what an assistant wrote through the MCP server while the window was in the background.
  useEffect(() => watchFocus(), [])

  // Cards answered "Again" come due again within minutes: recount every few minutes.
  // The day is checked too: after sleep the midnight timer can land late, with focus never lost.
  useEffect(() => {
    const id = setInterval(() => {
      useApp.getState().syncDay()
      bumpData('decks')
    }, 5 * 60_000)
    return () => clearInterval(id)
  }, [])

  // Only once the theme is known: the saved one, or after a failed start the system's.
  // Set before paint, so the first frame already wears it.
  useLayoutEffect(() => {
    if (!ready && !failed) return
    document.documentElement.dataset.theme = theme
    void api.app.setTitlebar(theme)
  }, [ready, failed, theme])

  // Ctrl+K search, Ctrl+N new note, Ctrl+1 Today, Ctrl+2 Study, Ctrl+, settings, F1 shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F1' && !e.repeat) {
        e.preventDefault()
        useApp.getState().setShortcutsOpen(!useApp.getState().shortcutsOpen)
        return
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.repeat) return
      const key = e.key.toLowerCase()
      const app = useApp.getState()
      if (key === 'k') {
        e.preventDefault()
        app.setPaletteOpen(!app.paletteOpen)
      } else if (key === 'n') {
        e.preventDefault()
        void app.newNote()
      } else if (key === '1' || key === '2') {
        e.preventDefault()
        app.setView(key === '1' ? 'today' : 'study')
        app.setSettingsOpen(false)
        app.setShortcutsOpen(false)
      } else if (key === ',') {
        e.preventDefault()
        app.setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (failed) {
    return (
      <div className="titlebar-drag flex h-full flex-col items-center justify-center gap-4 bg-app p-8 text-center text-sm text-muted">
        Inkling could not open its data.
        <button
          type="button"
          onClick={() => {
            useApp.setState({ failed: false })
            void useApp.getState().init()
          }}
          className="no-drag rounded-md border border-edge px-3 py-1.5 text-ink"
        >
          Try again
        </button>
      </div>
    )
  }
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
          className="no-drag ml-4 flex h-8 w-80 items-center gap-2 rounded-md bg-hover px-3 text-sm text-muted transition-colors hover:text-ink"
        >
          <Search size={15} />
          Search
          <span className="ml-auto text-xs">Ctrl+K</span>
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
      {shortcutsOpen && <ShortcutsModal />}
      <Toaster />
    </div>
  )
}
