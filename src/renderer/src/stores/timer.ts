import { create } from 'zustand'
import { useApp, bumpData } from './app'

const api = window.inkling

/** mm:ss for countdown displays. The Study timer and the UserBar chip both use this. */
export function fmtClock(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

interface TimerState {
  running: boolean
  mode: 'focus' | 'break'
  secondsLeft: number
  totalSeconds: number
  sessionId: number | null
  linkedLabel: string | null
  linkedTaskId: number | null
  linkedDeckId: number | null
  justFinished: boolean

  start(minutes: number, link?: { taskId?: number; deckId?: number; label?: string }): Promise<void>
  startBreak(minutes: number): void
  pause(): void
  resume(): void
  reset(): void
  dismissFinished(): void
}

let interval: ReturnType<typeof setInterval> | null = null

function stopTicking(): void {
  if (interval) clearInterval(interval)
  interval = null
}

export const useTimer = create<TimerState>((set, get) => {
  const tick = (): void => {
    const s = get()
    if (!s.running) return
    if (s.secondsLeft <= 1) {
      stopTicking()
      if (s.mode === 'focus') {
        const minutes = Math.round(s.totalSeconds / 60)
        // broadcast only reaches OTHER windows; bump locally so Today/RightPanel refresh too
        if (s.sessionId !== null) void api.focus.complete(s.sessionId, minutes).then(() => bumpData('focus'))
        void useApp.getState().bumpStreak()
        useApp.getState().celebrate()
        set({ running: false, secondsLeft: 0, justFinished: true, sessionId: null })
      } else {
        set({ running: false, secondsLeft: 0, justFinished: true })
      }
      return
    }
    set({ secondsLeft: s.secondsLeft - 1 })
  }

  const startTicking = (): void => {
    stopTicking()
    interval = setInterval(tick, 1000)
  }

  return {
    running: false,
    mode: 'focus',
    secondsLeft: 25 * 60,
    totalSeconds: 25 * 60,
    sessionId: null,
    linkedLabel: null,
    linkedTaskId: null,
    linkedDeckId: null,
    justFinished: false,

    start: async (minutes, link) => {
      const sessionId = await api.focus.start({ task_id: link?.taskId ?? null, deck_id: link?.deckId ?? null })
      set({
        running: true,
        mode: 'focus',
        secondsLeft: minutes * 60,
        totalSeconds: minutes * 60,
        sessionId,
        linkedLabel: link?.label ?? null,
        linkedTaskId: link?.taskId ?? null,
        linkedDeckId: link?.deckId ?? null,
        justFinished: false
      })
      startTicking()
    },
    startBreak: (minutes) => {
      set({ running: true, mode: 'break', secondsLeft: minutes * 60, totalSeconds: minutes * 60, sessionId: null, justFinished: false })
      startTicking()
    },
    pause: () => {
      stopTicking()
      set({ running: false })
    },
    resume: () => {
      if (get().secondsLeft > 0) {
        set({ running: true })
        startTicking()
      }
    },
    reset: () => {
      stopTicking()
      set({ running: false, secondsLeft: get().totalSeconds, sessionId: null, justFinished: false })
    },
    dismissFinished: () => set({ justFinished: false })
  }
})
