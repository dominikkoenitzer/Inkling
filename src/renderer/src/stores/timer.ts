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
/**
 * Wall-clock moment the running countdown reaches zero. Ticks only re-read it: a hidden or
 * minimised window gets its timers throttled, and counting ticks would stretch the session.
 */
let endsAt: number | null = null

function stopTicking(): void {
  if (interval) clearInterval(interval)
  interval = null
  endsAt = null
}

/** Whole seconds until `endsAt`, rounded up so the display never skips its last second. */
function secondsUntilEnd(): number {
  return endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
}

export const useTimer = create<TimerState>((set, get) => {
  const tick = (): void => {
    const s = get()
    if (!s.running) return
    const left = secondsUntilEnd()
    if (left <= 0) {
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
    set({ secondsLeft: left })
  }

  const startTicking = (): void => {
    stopTicking()
    endsAt = Date.now() + get().secondsLeft * 1000
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
      // Defense against any caller starting over a live focus session: bank the minutes
      // already elapsed on it (so progress still counts) instead of orphaning its row.
      const prev = get()
      if (prev.sessionId !== null && prev.mode === 'focus') {
        stopTicking()
        const elapsed = Math.round((prev.totalSeconds - prev.secondsLeft) / 60)
        if (elapsed > 0) void api.focus.complete(prev.sessionId, elapsed).then(() => bumpData('focus'))
      }
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
      // Bank the exact time left before dropping the end moment, in case no tick ran lately.
      const running = get().running && endsAt !== null
      const left = running ? secondsUntilEnd() : get().secondsLeft
      // The end already passed while no tick ran: finish the session rather than strand it at 0.
      if (running && left <= 0) return tick()
      stopTicking()
      set({ running: false, secondsLeft: left })
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
