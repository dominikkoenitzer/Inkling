// Window chrome per theme, shared by window creation and the theme switch.

export type ThemeName = 'light' | 'dark'

export const TITLEBAR_HEIGHT = 44

export const CHROME: Record<ThemeName, { color: string; symbolColor: string }> = {
  light: { color: '#fbfaf8', symbolColor: '#5f5a52' },
  dark: { color: '#1a1918', symbolColor: '#a39f97' }
}

/** The stored setting as a theme. Older builds stored "cozy", the light one. */
export function themeOf(value: string | null | undefined): ThemeName {
  return value === 'dark' ? 'dark' : 'light'
}
