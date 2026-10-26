import { describe, expect, it } from 'vitest'
import { nextRows, settleRow, type Row } from '../src/renderer/src/lib/motion'

const id = (n: number): number => n
const view = (rows: Row<number>[] | null): string[] | null => rows && rows.map((r) => `${r.key}:${r.state}`)

describe('nextRows', () => {
  it('shows the first list as it is', () => {
    expect(view(nextRows(null, [1, 2], id))).toEqual(['1:shown', '2:shown'])
  })

  it('waits for a list to arrive', () => {
    expect(nextRows<number>(null, null, id)).toBeNull()
    const rows = nextRows(null, [1], id)
    expect(nextRows(rows, null, id)).toBe(rows)
  })

  it('lets new rows enter where they join', () => {
    const rows = nextRows(null, [1, 3], id)
    expect(view(nextRows(rows, [1, 2, 3, 4], id))).toEqual(['1:shown', '2:entering', '3:shown', '4:entering'])
  })

  it('keeps a row that went in its place while it leaves', () => {
    const rows = nextRows(null, [1, 2, 3], id)
    expect(view(nextRows(rows, [1, 3], id))).toEqual(['1:shown', '2:leaving', '3:shown'])
    expect(view(nextRows(rows, [2, 3], id))).toEqual(['1:leaving', '2:shown', '3:shown'])
    expect(view(nextRows(rows, [], id))).toEqual(['1:leaving', '2:leaving', '3:leaving'])
  })

  it('keeps leaving rows leaving through the next change', () => {
    const rows = nextRows(nextRows(null, [1, 2, 3], id), [1, 3], id)
    expect(view(nextRows(rows, [1, 3, 4], id))).toEqual(['1:shown', '2:leaving', '3:shown', '4:entering'])
  })

  it('brings a leaving row back in', () => {
    const rows = nextRows(nextRows(null, [1, 2], id), [1], id)
    expect(view(nextRows(rows, [1, 2], id))).toEqual(['1:shown', '2:entering'])
  })

  it('keeps an entering row entering until it settles', () => {
    const rows = nextRows(nextRows(null, [1], id), [1, 2], id)
    expect(view(nextRows(rows, [2, 1], id))).toEqual(['2:entering', '1:shown'])
  })

  it('carries the newest item for a row', () => {
    const rows = nextRows(null, [{ id: 1, t: 'a' }], (x) => x.id)
    expect(nextRows(rows, [{ id: 1, t: 'b' }], (x) => x.id)?.[0].item.t).toBe('b')
  })
})

describe('settleRow', () => {
  const rows = nextRows(nextRows(null, [1, 2], id), [1, 3], id)!

  it('shows an entered row and drops a left one', () => {
    expect(view(settleRow(rows, 3))).toEqual(['1:shown', '2:leaving', '3:shown'])
    expect(view(settleRow(rows, '2'))).toEqual(['1:shown', '3:entering'])
  })

  it('leaves settled and unknown rows alone', () => {
    expect(settleRow(rows, 1)).toBe(rows)
    expect(settleRow(rows, 9)).toBe(rows)
  })
})
