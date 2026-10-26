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
import { setTitlebar } from '@/lib/calls'
import { ariaKeys, keyLabel, takeShortcut } from '@/lib/keys'
import type { AppCommand } from '@shared/api'

const api = window.inkling

/** A menu bar command: what its shortcut does, except that it always opens rather than toggles. */
function runCommand(command: AppCommand): void {
  const app = useApp.getState()
  if (command === 'new-note') void app.newNote()
  else if (command === 'search') app.setPaletteOpen(true)
  else if (command === 'settings') app.setSettingsOpen(true)
  else if (command === 'shortcuts') app.setShortcutsOpen(true)
  else {
    app.setView(command)
    app.setSettingsOpen(false)
    app.setShortcutsOpen(false)
  }
}

/** A shortcut key: its menu command, except that search and the shortcuts list close again. */
function runKey(command: AppCommand): void {
  const app = useApp.getState()
  if (command === 'search') app.setPaletteOpen(!app.paletteOpen)
  else if (command === 'shortcuts') app.setShortcutsOpen(!app.shortcutsOpen)
  else runCommand(command)
}

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

  // And while it is in front: the main process says when another process has written.
  useEffect(() => api.events.onDataChanged(() => window.dispatchEvent(new Event('inkling:outside-write'))), [])
  useEffect(() => api.events.onCommand(runCommand), [])

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
    void setTitlebar(theme)
  }, [ready, failed, theme])

  // Ctrl+K search, Ctrl+N new note, Ctrl+1 Today, Ctrl+2 Flashcards, Ctrl+, settings, F1 shortcuts; Command on a Mac, where Command+/ opens the shortcuts too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => takeShortcut(e, runKey)
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
        {/* Starts after the window buttons when they share the bar, as on a Mac. */}
        <div
          className="flex h-full shrink-0 items-center gap-2"
          style={{ width: 'var(--sidebar-w)', paddingLeft: 'max(1rem, env(titlebar-area-x, 0px))' }}
        >
          <LogoMark size={18} />
          <span className="text-sm font-semibold tracking-tight">Inkling</span>
        </div>
        <button
          type="button"
          onClick={() => useApp.getState().setPaletteOpen(true)}
          aria-keyshortcuts={ariaKeys('Ctrl+K')}
          className="no-drag ml-4 flex h-8 w-80 items-center gap-2 rounded-md bg-hover px-3 text-sm text-muted transition-colors hover:text-ink"
        >
          <Search size={15} />
          Search
          <span aria-hidden="true" className="ml-auto text-xs">
            {keyLabel('Ctrl+K')}
          </span>
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
