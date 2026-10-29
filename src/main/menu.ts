import type { MenuItemConstructorOptions } from 'electron'

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
