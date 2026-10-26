import { describe, expect, it } from 'vitest'
import { commandRelay } from '../src/main/commands'
import type { AppCommand } from '../src/shared/api'

describe('commandRelay', () => {
  it('sends a command straight to a page that listens', () => {
    const relay = commandRelay()
    const sent: AppCommand[] = []
    relay.listening((c) => sent.push(c))
    relay.run('search')
    expect(sent).toEqual(['search'])
  })

  it('holds a command for a page that is still loading', () => {
    const relay = commandRelay()
    relay.reset()
    relay.run('new-note')
    const sent: AppCommand[] = []
    relay.listening((c) => sent.push(c))
    expect(sent).toEqual(['new-note'])
  })

  it('sends a held command once', () => {
    const relay = commandRelay()
    relay.run('settings')
    const first: AppCommand[] = []
    relay.listening((c) => first.push(c))
    const second: AppCommand[] = []
    relay.listening((c) => second.push(c))
    expect(first).toEqual(['settings'])
    expect(second).toEqual([])
  })

  it('stops sending to a page once a new one loads', () => {
    const relay = commandRelay()
    const old: AppCommand[] = []
    relay.listening((c) => old.push(c))
    relay.reset()
    relay.run('today')
    expect(old).toEqual([])
  })
})
