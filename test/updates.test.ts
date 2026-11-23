import { describe, expect, it } from 'vitest'
import { DOWNLOAD_PAGE, noticesUpdates, updatesItself, versionToNotice } from '../src/main/updates'

describe('updatesItself', () => {
  it('updates a packaged build on Windows and Linux', () => {
    expect(updatesItself('win32', true)).toBe(true)
    expect(updatesItself('linux', true)).toBe(true)
  })

  it('leaves the Mac alone, where an unsigned app cannot install its own update', () => {
    expect(updatesItself('darwin', true)).toBe(false)
  })

  it('never updates a development build', () => {
    expect(updatesItself('win32', false)).toBe(false)
  })
})

describe('the update notice on a Mac', () => {
  it('reads the feed on a packaged Mac once a download page is set', () => {
    expect(noticesUpdates('darwin', true, 'https://example.org/download')).toBe(true)
  })

  it('stays off without a download page, as this build ships', () => {
    expect(DOWNLOAD_PAGE).toBe('')
    expect(noticesUpdates('darwin', true, DOWNLOAD_PAGE)).toBe(false)
  })

  it('is never there on Windows, Linux or a development build', () => {
    expect(noticesUpdates('win32', true, 'https://example.org/download')).toBe(false)
    expect(noticesUpdates('linux', true, 'https://example.org/download')).toBe(false)
    expect(noticesUpdates('darwin', false, 'https://example.org/download')).toBe(false)
  })

  it('tells each new version once', () => {
    expect(versionToNotice(true, '0.9.5', null)).toBe('0.9.5')
    expect(versionToNotice(true, '0.9.5', '0.9.5')).toBe(null)
    expect(versionToNotice(true, '0.9.6', '0.9.5')).toBe('0.9.6')
    expect(versionToNotice(false, '0.9.4', null)).toBe(null)
  })
})
