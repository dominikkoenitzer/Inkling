import type { AssistantStatus } from '@shared/types'

/** The assistant rows Settings lists, or null while the list is still on its way and the block waits for it. */
export function assistantRows(list: AssistantStatus[] | null): AssistantStatus[] | null {
  return list && list.filter((a) => a.state !== 'missing')
}
