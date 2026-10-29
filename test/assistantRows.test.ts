import { describe, expect, it } from 'vitest'
import { assistantRows } from '@/lib/assistants'
import type { AssistantStatus } from '@shared/types'

const app = (id: AssistantStatus['id'], state: AssistantStatus['state']): AssistantStatus => ({
  id,
  name: id === 'desktop' ? 'Desktop app' : 'Terminal tool',
  state,
  file: `${id}.json`
})

describe('the assistant rows in Settings', () => {
  it('hold back the whole block until the list is in, so no row moves after it shows', () => {
    expect(assistantRows(null)).toBeNull()
  })

  it('list the apps found and leave out the ones that are not installed', () => {
    expect(assistantRows([app('desktop', 'on'), app('terminal', 'missing')])).toEqual([app('desktop', 'on')])
  })

  it('show the block with only the general row when no app is found', () => {
    expect(assistantRows([app('desktop', 'missing'), app('terminal', 'missing')])).toEqual([])
    expect(assistantRows([])).toEqual([])
  })
})
