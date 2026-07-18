import { useEffect, useState } from 'react'
import { Play, Pause, RotateCcw, Coffee } from 'lucide-react'
import { useTimer, fmtClock } from '@/stores/timer'
import { useVersion } from '@/stores/app'
import { Inky } from '@/components/Inky'
import { Button } from '@/components/ui'
import type { Notebook, Deck, Task } from '@shared/types'

const api = window.inkling

export function FocusTimer({ notebook, decks }: { notebook: Notebook; decks: Deck[] }): React.JSX.Element {
  const timer = useTimer()
  const tasksVersion = useVersion('tasks')
  const focusVersion = useVersion('focus')
  const [tasks, setTasks] = useState<Task[]>([])
  const [minutesToday, setMinutesToday] = useState(0)
  const [link, setLink] = useState<string>('none') // "none" | "task:ID" | "deck:ID"
  const [preset, setPreset] = useState(25)

  useEffect(() => {
    void api.tasks.list(notebook.id).then((all) => setTasks(all.filter((t) => t.status !== 'done' && t.parent_task_id === null)))
  }, [notebook.id, tasksVersion])

  useEffect(() => {
    void api.focus.todayMinutes().then(setMinutesToday)
  }, [focusVersion, timer.justFinished])

  const clock = fmtClock(timer.secondsLeft)
  const progress = timer.totalSeconds > 0 ? 1 - timer.secondsLeft / timer.totalSeconds : 0

  const start = (): void => {
    const [kind, idStr] = link.split(':')
    const id = idStr ? Number(idStr) : undefined
    const label =
      kind === 'task' ? tasks.find((t) => t.id === id)?.title : kind === 'deck' ? decks.find((d) => d.id === id)?.name : undefined
    void timer.start(preset, kind === 'task' ? { taskId: id, label } : kind === 'deck' ? { deckId: id, label } : undefined)
  }

  if (timer.justFinished && timer.mode === 'focus') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-edge bg-raised p-5 text-center fade-up">
        <Inky pose="happy" size={84} />
        <div className="font-semibold">Nice focus session!</div>
        <div className="text-xs text-muted">{minutesToday} focused minutes today. Take a breather, you earned it.</div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => timer.startBreak(5)}>
            <Coffee size={14} /> 5 min break
          </Button>
          <Button variant="ghost" onClick={timer.dismissFinished}>
            Skip
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-edge bg-raised p-5">
      <div className="relative mx-auto mb-4 flex h-40 w-40 items-center justify-center">
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
          <circle cx="50" cy="50" r="44" fill="none" stroke="var(--bg-raised)" strokeWidth="7" />
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${Math.PI * 88}`}
            strokeDashoffset={`${Math.PI * 88 * (1 - progress)}`}
            className="transition-all duration-1000"
          />
        </svg>
        <div className="text-center">
          <div className="text-3xl font-bold tabular-nums">
            {clock}
          </div>
          <div className="text-[11px] text-muted">{timer.mode === 'break' ? 'break ☕' : timer.linkedLabel ?? 'focus'}</div>
        </div>
      </div>

      {!timer.running && timer.secondsLeft === timer.totalSeconds && (
        <>
          <div className="mb-2 flex justify-center gap-1.5">
            {[15, 25, 50].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPreset(m)}
                className={`rounded-lg border px-3 py-1 text-xs font-semibold ${preset === m ? 'border-transparent text-white' : 'border-edge text-muted'}`}
                style={preset === m ? { background: 'var(--accent)' } : undefined}
              >
                {m}m
              </button>
            ))}
          </div>
          <select
            value={link}
            onChange={(e) => setLink(e.target.value)}
            className="mb-3 w-full rounded-lg border border-edge bg-sunken px-2 py-1.5 text-xs text-muted"
          >
            <option value="none">No link, just focus</option>
            <optgroup label="Tasks">
              {tasks.map((t) => (
                <option key={t.id} value={`task:${t.id}`}>
                  {t.title}
                </option>
              ))}
            </optgroup>
            <optgroup label="Decks">
              {decks.map((d) => (
                <option key={d.id} value={`deck:${d.id}`}>
                  {d.name}
                </option>
              ))}
            </optgroup>
          </select>
        </>
      )}

      <div className="flex justify-center gap-2">
        {timer.running ? (
          <Button onClick={timer.pause}>
            <Pause size={14} /> Pause
          </Button>
        ) : timer.secondsLeft < timer.totalSeconds && timer.secondsLeft > 0 ? (
          <Button variant="primary" onClick={timer.resume}>
            <Play size={14} /> Resume
          </Button>
        ) : (
          <Button variant="primary" onClick={start}>
            <Play size={14} /> Start focus
          </Button>
        )}
        {(timer.running || timer.secondsLeft < timer.totalSeconds) && (
          <Button variant="ghost" onClick={timer.reset} title="Reset">
            <RotateCcw size={14} />
          </Button>
        )}
      </div>

      <p className="mt-3 text-center text-[11px] text-faint">{minutesToday > 0 ? `${minutesToday} focused minutes today` : 'Focused minutes count toward your streak'}</p>
    </div>
  )
}
