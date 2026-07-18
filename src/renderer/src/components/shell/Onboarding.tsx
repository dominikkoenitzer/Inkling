import { useState } from 'react'
import { GraduationCap, Briefcase, Sparkles } from 'lucide-react'
import { useApp } from '@/stores/app'
import { Inky } from '@/components/Inky'
import { Button, inputCls } from '@/components/ui'

const api = window.inkling

type Purpose = 'school' | 'work' | 'personal'

export function Onboarding(): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState<Purpose>('school')
  const [journal, setJournal] = useState(true)
  const [busy, setBusy] = useState(false)

  const finish = async (): Promise<void> => {
    setBusy(true)
    await api.app.completeOnboarding({ notebookName: name.trim() || 'My Notebook', purpose, journal })
    await useApp.getState().finishOnboarding()
  }

  return (
    <div className="flex h-full items-center justify-center bg-app p-6">
      <div className="pop-in w-full max-w-md rounded-lg border border-edge bg-panel p-8 text-center" style={{ boxShadow: 'var(--shadow)' }}>
        <div className="mb-2 flex justify-center">
          <Inky pose="wave" size={110} />
        </div>

        {step === 0 && (
          <div className="fade-up">
            <h1 className="mb-1 text-xl font-bold">Hi! I’m Inky.</h1>
            <p className="mb-5 text-sm text-muted">Welcome to Inkling, where studying gets fun. What should we call your first notebook?</p>
            <input
              autoFocus
              className={`${inputCls} mb-4 text-center`}
              placeholder="e.g. Biology 101, Life, Work…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setStep(1)}
            />
            <Button variant="primary" className="w-full justify-center" onClick={() => setStep(1)}>
              Next
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="fade-up">
            <h1 className="mb-1 text-xl font-bold">What’s this mostly for?</h1>
            <p className="mb-5 text-sm text-muted">We’ll set up sensible starter notebooks. Rename or delete them anytime.</p>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {(
                [
                  ['school', 'School', <GraduationCap key="s" size={20} />],
                  ['work', 'Work', <Briefcase key="w" size={20} />],
                  ['personal', 'Personal', <Sparkles key="p" size={20} />]
                ] as Array<[Purpose, string, React.JSX.Element]>
              ).map(([p, label, icon]) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPurpose(p)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-4 text-sm font-medium transition-colors ${
                    purpose === p ? 'border-transparent text-white' : 'border-edge text-muted hover:text-ink'
                  }`}
                  style={purpose === p ? { background: 'var(--accent)' } : undefined}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button variant="primary" className="flex-1 justify-center" onClick={() => setStep(2)}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="fade-up">
            <h1 className="mb-1 text-xl font-bold">One more thing</h1>
            <p className="mb-5 text-sm text-muted">Want a daily journal? A fresh page each day, one click away. (Totally optional.)</p>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setJournal(true)}
                className={`rounded-xl border p-4 text-sm font-medium ${journal ? 'border-transparent text-white' : 'border-edge text-muted'}`}
                style={journal ? { background: 'var(--accent)' } : undefined}
              >
                Yes, please 📓
              </button>
              <button
                type="button"
                onClick={() => setJournal(false)}
                className={`rounded-xl border p-4 text-sm font-medium ${!journal ? 'border-transparent text-white' : 'border-edge text-muted'}`}
                style={!journal ? { background: 'var(--accent)' } : undefined}
              >
                Not for me
              </button>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button variant="primary" className="flex-1 justify-center" onClick={() => void finish()} disabled={busy}>
                {busy ? 'Setting things up…' : 'Let’s go!'}
              </Button>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-full transition-colors" style={{ background: i === step ? 'var(--accent)' : 'var(--border)' }} />
          ))}
        </div>
      </div>
    </div>
  )
}
