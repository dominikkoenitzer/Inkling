import type { AppCommand } from '@shared/api'

/**
 * Carries menu commands to the page. While a page is loading, a command waits until the page
 * says it listens, so New Note picked with the window closed still makes a note in the new one.
 */
export function commandRelay(): {
  /** The page listens from now on through `send`; a waiting command goes out at once. */
  listening(send: (command: AppCommand) => void): void
  /** A new page is loading: commands wait for it. */
  reset(): void
  run(command: AppCommand): void
} {
  let send: ((command: AppCommand) => void) | null = null
  let waiting: AppCommand | null = null
  return {
    listening(next) {
      send = next
      if (waiting) next(waiting)
      waiting = null
    },
    reset() {
      send = null
    },
    run(command) {
      if (send) send(command)
      else waiting = command
    }
  }
}
