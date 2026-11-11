/** Rows keep the day something was done, never the time: local midnight as a UTC ISO string. */

import { addDays, dayStamp } from '@shared/day'

export { localDay } from '@shared/day'

/** Today, as the stamp every date column stores. */
export const today = (): string => dayStamp()

/** The start of tomorrow: a card is due when its date falls before it. */
export const dueBefore = (): string => dayStamp(addDays(new Date(), 1))
