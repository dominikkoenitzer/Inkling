/** The card on screen as "n of total", counted from one; the last card's number stays on the end screen. */
export function reviewPosition(index: number, total: number): number {
  return Math.min(index + 1, total)
}

/** How much of the session is done, from 0 to 1: the cards graded so far. */
export function reviewDone(index: number, total: number): number {
  return total ? Math.min(index, total) / total : 0
}
