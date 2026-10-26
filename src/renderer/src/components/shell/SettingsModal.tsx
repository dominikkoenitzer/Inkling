import { useEffect, useState } from 'react'
import { useApp } from '@/stores/app'
import { Button, Modal, Segmented } from '@/components/ui'
import type { Exit } from '@/lib/motion'
import type { AssistantStatus } from '@shared/types'

const api = window.inkling

const STATUS: Record<AssistantStatus['state'], string> = {
  missing: 'Not found on this computer',
  off: 'Not connected',
  on: 'Connected',
  stale: 'Set up for another copy of Inkling',
  unreadable: 'Its settings file cannot be read'
}

export function SettingsModal(exit: Exit): React.JSX.Element {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)

  return (
    <Modal title="Settings" width={460} onClose={() => useApp.getState().setSettingsOpen(false)} {...exit}>
      <div className="flex items-center justify-between">
        <span className="text-sm">Theme</span>
        <Segmented
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
          value={theme}
          onChange={setTheme}
        />
      </div>
      <Assistants />
      <p className="mt-6 border-t border-edge pt-4 text-xs text-faint">Inkling {__APP_VERSION__}</p>
    </Modal>
  )
}

/** Adds Inkling to the assistant apps found on this computer, or copies the setup for any other. */
function Assistants(): React.JSX.Element {
  const [list, setList] = useState<AssistantStatus[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const say = (message: string): void => useApp.getState().showToast({ message, durationMs: 4000 })

  useEffect(() => {
    let alive = true
    api.assistants.list().then(
      (l) => alive && setList(l),
      () => alive && setList([])
    )
    return () => {
      alive = false
    }
  }, [])

  const toggle = async (a: AssistantStatus): Promise<void> => {
    setBusy(a.id)
    try {
      const connect = a.state !== 'on'
      setList(await (connect ? api.assistants.connect(a.id) : api.assistants.disconnect(a.id)))
      say(connect ? `Connected. Restart the ${a.name.toLowerCase()} to use Inkling there.` : `Disconnected from the ${a.name.toLowerCase()}.`)
    } catch (err) {
      say(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(null)
    }
  }

  const copy = async (): Promise<void> => {
    try {
      await api.assistants.copySetup()
      say('Setup copied. Paste it into your assistant’s MCP settings.')
    } catch {
      say('Could not copy the setup.')
    }
  }

  return (
    <section className="mt-6 border-t border-edge pt-4" aria-labelledby="assistants-title">
      <h3 id="assistants-title" className="text-sm font-medium">
        Connect an AI assistant
      </h3>
      <p className="mt-1 text-xs text-muted">Let an assistant on this computer work with your notes, to-dos and flashcards.</p>
      <ul className="mt-3">
        {(list ?? [])
          .filter((a) => a.state !== 'missing')
          .map((a) => (
          <li key={a.id} className="flex items-center gap-3 border-b border-edge py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm">{a.name}</p>
              <p className={`text-xs ${a.state === 'on' ? 'text-accent-text' : 'text-faint'}`}>{STATUS[a.state]}</p>
            </div>
            {(a.state === 'off' || a.state === 'stale') && (
              <Button variant="primary" disabled={busy !== null} onClick={() => void toggle(a)}>
                {a.state === 'stale' ? 'Fix' : 'Connect'}
              </Button>
            )}
            {a.state === 'on' && (
              <Button disabled={busy !== null} onClick={() => void toggle(a)}>
                Disconnect
              </Button>
            )}
          </li>
        ))}
        <li className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm">Another assistant</p>
            <p className="text-xs text-faint">Any app that takes MCP servers</p>
          </div>
          <Button onClick={() => void copy()}>Copy setup</Button>
        </li>
      </ul>
    </section>
  )
}
