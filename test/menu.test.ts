import { describe, expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { plainMenu } from '../src/main/menu'

/** Every item of a menu template, nested ones included. */
function items(menu: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return menu.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? items(i.submenu) : [])])
}

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
