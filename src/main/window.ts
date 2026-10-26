// Window chrome per theme, shared by window creation and the theme switch.

export type ThemeName = 'light' | 'dark'

export const TITLEBAR_HEIGHT = 44

/**
 * Where the Mac window buttons sit: centred in the bar, and as far from the left edge as from
 * the top, the way a native toolbar places them. The buttons are 14 points tall.
 */
export const WINDOW_BUTTONS = { x: (TITLEBAR_HEIGHT - 14) / 2, y: (TITLEBAR_HEIGHT - 14) / 2 }

/** The window's usual first size, made to fit a small screen but never below its minimum. */
export function firstSize(workArea: { width: number; height: number }): { width: number; height: number } {
  return { width: Math.max(860, Math.min(1360, workArea.width)), height: Math.max(560, Math.min(860, workArea.height)) }
}

export const CHROME: Record<ThemeName, { color: string; symbolColor: string }> = {
  light: { color: '#fbfaf8', symbolColor: '#5f5a52' },
  dark: { color: '#1a1918', symbolColor: '#a39f97' }
}

/** The stored setting as a theme. Older builds stored "cozy", the light one. */
export function themeOf(value: string | null | undefined): ThemeName {
  return value === 'dark' ? 'dark' : 'light'
}
