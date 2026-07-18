import { Moon, Flame, Type, Contrast, Database, Keyboard, Percent } from 'lucide-react'
import { useApp } from '@/stores/app'
import { GRADING_SYSTEM_OPTIONS } from '@shared/grades'
import { Modal, Segmented } from '@/components/ui'
import { LogoMark } from '@/components/Inky'

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

        <Row icon={<Type size={16} />} label="Font size" hint="Applies everywhere, including the editor.">
          <Segmented
            options={[
              { value: 's', label: 'Small' },
              { value: 'm', label: 'Medium' },
              { value: 'l', label: 'Large' }
            ]}
            value={app.fontScale}
            onChange={app.setFontScale}
          />
        </Row>

        <Row icon={<Contrast size={16} />} label="High contrast" hint="Stronger borders and text for readability.">
          <Segmented
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' }
            ]}
            value={app.contrast ? 'on' : 'off'}
            onChange={(v) => app.setContrast(v === 'on')}
          />
        </Row>

        <Row icon={<Percent size={16} />} label="Grading" hint="How Inkling shows your averages: Swiss 1–6 (6 is best), US letters, or plain percentages.">
          <Segmented options={GRADING_SYSTEM_OPTIONS} value={app.gradingSystem} onChange={app.setGradingSystem} />
        </Row>

        <Row icon={<Keyboard size={16} />} label="Shortcuts" hint="">
          <div className="space-y-1 text-xs text-muted">
            <div><Kbd>Ctrl K</Kbd> command palette & search</div>
            <div><Kbd>Ctrl Alt N</Kbd> quick-add from anywhere (global)</div>
            <div><Kbd>Space</Kbd> reveal flashcard · <Kbd>1–4</Kbd> grade it</div>
          </div>
        </Row>

        <Row icon={<Database size={16} />} label="Your data" hint="">
          <p className="text-xs text-muted">
            Everything lives on this machine in a local SQLite database, fully offline. The last 5 backups are kept automatically next to it.
          </p>
        </Row>

        <Row icon={<Flame size={16} />} label="Streak" hint="">
          <p className="text-xs text-muted">
            {app.streak.count > 0 ? `${app.streak.count} day${app.streak.count === 1 ? '' : 's'}. Reviews and focus sessions keep it alive. Missing a day just quietly resets it; no shame here.` : 'Review flashcards or finish a focus session to start one.'}
          </p>
        </Row>

        <div className="flex items-center gap-2 border-t border-edge pt-4 text-xs text-faint">
          <LogoMark size={18} />
          Inkling 0.3.0 · notes, tasks, study and grades. Studying, made fun.
        </div>
      </div>
    </Modal>
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

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <kbd className="rounded border border-edge bg-sunken px-1 py-0.5 text-[11px]">{children}</kbd>
}
