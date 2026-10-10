import { useState } from 'react'
import { Moon, Sparkles } from 'lucide-react'
import { useApp, bumpData } from '@/stores/app'
import { DEFAULT_PARAMS } from '@shared/fsrs'
import type { OptimiseOutcome } from '@shared/types'
import { Button, Modal, Segmented } from '@/components/ui'
import { LogoMark } from '@/components/Inky'

const api = window.inkling

export function SettingsModal(): React.JSX.Element {
  const app = useApp()

  return (
    <Modal title="Settings" onClose={() => app.setSettingsOpen(false)} width={520}>
      <div className="space-y-5">
        <Row icon={<Moon size={16} />} label="Theme" hint="Dark is sleek. Cozy is warm off-white with soft colors.">
          <Segmented
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'cozy', label: 'Cozy' }
            ]}
            value={app.theme}
            onChange={app.setTheme}
          />
        </Row>

        <Row icon={<Sparkles size={16} />} label="Your reviews" hint="Fit the scheduler to how you actually remember.">
          <Optimise />
        </Row>

        <div className="flex items-center gap-2 border-t border-edge pt-4 text-xs text-faint">
          <LogoMark size={18} />
          Inkling {__APP_VERSION__} · notes, tasks and study. Studying, made fun.
        </div>
      </div>
    </Modal>
  )
}

function outcomeText(o: OptimiseOutcome, fitted: boolean): string {
  if (o.status === 'too-few') {
    return `Needs ${o.needed} reviews a day or more apart, you have ${o.reviews}. Keeping the ${fitted ? 'current parameters' : 'defaults'}.`
  }
  if (o.status === 'no-better') return 'The parameters in use already fit your reviews best.'
  const better = Math.max(1, Math.round((1 - o.lossAfter / o.lossBefore) * 100))
  return `Fitted to ${o.reviews} reviews. Predictions ${better}% closer.`
}

function Optimise(): React.JSX.Element {
  const fitted = useApp((s) => s.fsrsParams.some((v, i) => v !== DEFAULT_PARAMS[i]))
  const setFsrsParams = useApp((s) => s.setFsrsParams)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const outcome = await api.decks.optimise()
      if (outcome.params) {
        setFsrsParams(outcome.params)
        bumpData('decks')
      }
      setMessage(outcomeText(outcome, fitted))
    } catch {
      setMessage('Could not optimise. Your parameters are unchanged.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Button onClick={() => void run()} disabled={busy}>
        {busy ? 'Optimising…' : 'Optimise from my reviews'}
      </Button>
      <p className="mt-1.5 text-[11px] text-faint" aria-live="polite">
        {message ?? (fitted ? 'Using parameters fitted to your reviews.' : 'Using the default parameters.')}
      </p>
    </div>
  )
}

function Row({ icon, label, hint, children }: { icon: React.ReactNode; label: string; hint: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <div>
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="text-muted">{icon}</span>
          {label}
        </div>
        {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}
