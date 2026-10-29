import { describe, expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { macMenu, plainMenu } from '../src/main/menu'
import type { AppCommand } from '../src/shared/api'

/** Every item of a menu template, nested ones included. */
function items(menu: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return menu.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? items(i.submenu) : [])])
}

const find = (menu: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions | undefined =>
  items(menu).find((i) => i.label === label)

describe('macMenu', () => {
  it('puts each app shortcut on Command and runs its command', () => {
    const sent: AppCommand[] = []
    const menu = macMenu((c) => sent.push(c), () => {}, true)
    const expected: Array<[string, string, AppCommand]> = [
      ['Settings…', 'Command+,', 'settings'],
      ['New Note', 'Command+N', 'new-note'],
      ['Today', 'Command+1', 'today'],
      ['Flashcards', 'Command+2', 'study'],
      ['Search…', 'Command+K', 'search'],
      ['Keyboard Shortcuts', 'Command+/', 'shortcuts']
    ]
    for (const [label, accelerator, command] of expected) {
      const item = find(menu, label)
      expect(item?.accelerator, label).toBe(accelerator)
      ;(item?.click as () => void)()
      expect(sent.at(-1)).toBe(command)
    }
  })

  it('keeps the system menus in their usual order', () => {
    expect(macMenu(() => {}, () => {}, true).map((i) => i.role)).toEqual(['appMenu', 'fileMenu', 'editMenu', 'viewMenu', 'windowMenu', 'help'])
  })

  it('brings the window back from the Window menu after it was closed', () => {
    let shown = 0
    const menu = macMenu(() => {}, () => shown++, true)
    const windowMenu = menu.find((i) => i.role === 'windowMenu')
    const item = items(Array.isArray(windowMenu?.submenu) ? windowMenu.submenu : []).find((i) => i.label === 'Main Window')
    ;(item?.click as () => void)()
    expect(shown).toBe(1)
  })

  it('leaves reload and the developer tools out of a release', () => {
    const roles = (packaged: boolean): unknown[] => items(macMenu(() => {}, () => {}, packaged)).map((i) => i.role)
    expect(roles(true)).not.toContain('reload')
    expect(roles(true)).not.toContain('toggleDevTools')
    expect(roles(false)).toContain('toggleDevTools')
  })
})

const roles = (packaged: boolean): unknown[] => items(plainMenu(packaged)).map((i) => i.role)

describe('plainMenu', () => {
  it('leaves reload and the developer tools out of a release', () => {
    expect(roles(true)).not.toContain('reload')
    expect(roles(true)).not.toContain('forceReload')
    expect(roles(true)).not.toContain('toggleDevTools')
  })

  it('binds no key of its own, so every key comes from a role', () => {
    expect(items(plainMenu(true)).filter((i) => i.accelerator)).toEqual([])
    expect(items(plainMenu(false)).filter((i) => i.accelerator)).toEqual([])
  })

  it('keeps the editing, zoom, full screen and window keys', () => {
    for (const packaged of [true, false]) {
      expect(roles(packaged)).toEqual(
        expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen', 'fileMenu', 'windowMenu'])
      )
    }
  })

  it('keeps reload and the developer tools in a dev build', () => {
    expect(roles(false)).toEqual(expect.arrayContaining(['reload', 'forceReload', 'toggleDevTools']))
  })
})
