import { useEffect, useMemo } from 'react'
import { useApp } from '@/stores/app'
import { accentVars, isColorKey } from '@/lib/colors'
import { IconRail } from '@/components/shell/IconRail'
import { Sidebar } from '@/components/shell/Sidebar'
import { MainPane } from '@/components/shell/MainPane'
import { RightPanel } from '@/components/shell/RightPanel'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { SettingsModal } from '@/components/shell/SettingsModal'
import { LogoMark } from '@/components/Inky'
import { Toaster } from '@/components/ui'

const api = window.inkling

export default function App(): React.JSX.Element {
  const app = useApp()

  useEffect(() => {
    void app.init()
    ;(window as unknown as Record<string, unknown>).__app = useApp // test hook for headless verification
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Theme on the root element; keep the native titlebar overlay in sync.
  useEffect(() => {
    document.documentElement.dataset.theme = app.theme
    void api.app.setTitlebar(
      app.theme === 'dark' ? { color: '#191a1d', symbolColor: '#b9bbc2' } : { color: '#e2d4bf', symbolColor: '#6b6355' }
    )
  }, [app.theme])

  // Global shortcuts: Ctrl+K palette, Ctrl+, settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useApp.getState().setPaletteOpen(!useApp.getState().paletteOpen)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        useApp.getState().setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const activeNotebook = app.notebooks.find((n) => n.id === app.activeNotebookId) ?? null
  const accent = useMemo(
    () => accentVars(isColorKey(activeNotebook?.color) ? activeNotebook!.color : 'teal', app.theme),
    [activeNotebook, app.theme]
  )

  if (!app.ready) {
    return (
      <div className="flex h-full items-center justify-center bg-app">
        <LogoMark size={44} />
      </div>
    )
  }

  return (
    <div style={accent} className="flex h-full flex-col bg-app text-base">
      {/* draggable titlebar strip (native window buttons overlay on the right) */}
      <div className="titlebar-drag flex h-9 shrink-0 items-center gap-2 pl-3 text-xs text-faint">
        <LogoMark size={16} />
        <span className="font-semibold tracking-wide">Inkling</span>
      </div>

      <div className="flex min-h-0 flex-1">
        <IconRail />
        <Sidebar />
        <main className="min-w-0 flex-1 bg-sunken">
          <MainPane />
        </main>
        <RightPanel />
      </div>

      {app.paletteOpen && <CommandPalette />}
      {app.settingsOpen && <SettingsModal />}
      <Toaster />
    </div>
  )
}
