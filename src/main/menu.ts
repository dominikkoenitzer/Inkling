import type { MenuItemConstructorOptions } from 'electron'
import type { AppCommand } from '@shared/api'

/**
 * The menu bar on a Mac: the system's own menus, plus the app's commands with the keys the
 * app already answers to. `run` sends a command to the window, `show` brings the window back
 * after it was closed; dev builds keep reload and the developer tools.
 */
export function macMenu(run: (command: AppCommand) => void, show: () => void, packaged: boolean): MenuItemConstructorOptions[] {
  return [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Command+,', click: () => run('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      role: 'fileMenu',
      submenu: [{ label: 'New Note', accelerator: 'Command+N', click: () => run('new-note') }, { type: 'separator' }, { role: 'close' }]
    },
    { role: 'editMenu' },
    {
      role: 'viewMenu',
      submenu: [
        { label: 'Today', accelerator: 'Command+1', click: () => run('today') },
        { label: 'Flashcards', accelerator: 'Command+2', click: () => run('study') },
        { type: 'separator' },
        { label: 'Search…', accelerator: 'Command+K', click: () => run('search') },
        { type: 'separator' },
        ...(packaged ? [] : ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[])),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { label: 'Main Window', click: show },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    { role: 'help', submenu: [{ label: 'Keyboard Shortcuts', accelerator: 'Command+/', click: () => run('shortcuts') }] }
  ]
}

/** The hidden menu on Windows and Linux: the stock keys for editing, zoom and the window, with reload and the developer tools in dev builds only. */
export function plainMenu(packaged: boolean): MenuItemConstructorOptions[] {
  return [
    { role: 'fileMenu' },
    {
      role: 'editMenu',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      role: 'viewMenu',
      submenu: [
        ...(packaged ? [] : ([{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[])),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
}
