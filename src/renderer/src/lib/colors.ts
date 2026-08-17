import type { ColorKey } from '@shared/types'
import type { CSSProperties } from 'react'

type Ramp = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>

/** 7+ stop ramps per brand color (§11) — 50/100 for backgrounds, 600+ for text/borders. */
export const RAMPS: Record<ColorKey, Ramp> = {
  teal: {
    50: '#E6F7F2',
    100: '#C6EDE2',
    200: '#92DEC8',
    300: '#59CBAB',
    400: '#26B593',
    500: '#10A37F',
    600: '#0C8568',
    700: '#096A53',
    800: '#064A3A',
    900: '#043227'
  },
  coral: {
    50: '#FDEFEA',
    100: '#FBDCD2',
    200: '#F7B9A5',
    300: '#F39478',
    400: '#F17C5B',
    500: '#EE6A45',
    600: '#C85234',
    700: '#A03F27',
    800: '#742C1B',
    900: '#4E1C11'
  },
  amber: {
    50: '#FDF3E3',
    100: '#FAE5C4',
    200: '#F5CB8B',
    300: '#EFB055',
    400: '#E99E31',
    500: '#E0921B',
    600: '#BB7714',
    700: '#955D10',
    800: '#6C430B',
    900: '#492C06'
  },
  pink: {
    50: '#FDEDF3',
    100: '#FBD9E5',
    200: '#F6B4CA',
    300: '#F18DAE',
    400: '#EC7399',
    500: '#E8608C',
    600: '#C44A72',
    700: '#9D395A',
    800: '#732941',
    900: '#4E1A2B'
  },
  gray: {
    50: '#F5F5F3',
    100: '#E9E9E5',
    200: '#D4D3CD',
    300: '#BAB9B2',
    400: '#A09F98',
    500: '#85847E',
    600: '#6B6A65',
    700: '#55544F',
    800: '#3E3D39',
    900: '#292824'
  }
}

export const COLOR_KEYS: ColorKey[] = ['teal', 'coral', 'amber', 'pink', 'gray']

export function isColorKey(v: string | null | undefined): v is ColorKey {
  return !!v && v in RAMPS
}

export function ramp(key: string | null | undefined): Ramp {
  return RAMPS[isColorKey(key) ? key : 'teal']
}

/** CSS vars for the active accent, tuned per theme so contrast holds (§11). */
export function accentVars(key: ColorKey, theme: 'dark' | 'cozy'): CSSProperties {
  const r = RAMPS[key]
  if (theme === 'dark') {
    return {
      '--accent': r[500],
      '--accent-soft': `color-mix(in srgb, ${r[500]} 22%, transparent)`,
      '--accent-text': r[300],
      // Dark shade of the accent, used to draw Inky's face on an accent-filled
      // body so the logo mark reads at any accent (see <LogoMark />).
      '--accent-ink': r[900]
    } as CSSProperties
  }
  return {
    '--accent': r[500],
    '--accent-soft': r[100],
    '--accent-text': r[700],
    '--accent-ink': r[900]
  } as CSSProperties
}

/** Theme-aware soft tint for icon bubbles and chips: subtle fill, readable glyph. */
export function softTint(key: string | null | undefined, theme: 'dark' | 'cozy'): { bg: string; text: string } {
  const r = ramp(key)
  if (theme === 'dark') return { bg: `color-mix(in srgb, ${r[500]} 18%, transparent)`, text: r[300] }
  return { bg: r[100], text: r[700] }
}

/** Sticky-note fill/text per theme. */
export function stickyColors(key: string | null | undefined, theme: 'dark' | 'cozy'): { bg: string; text: string; edge: string } {
  const r = ramp(key)
  if (theme === 'dark') return { bg: r[900], text: r[100], edge: r[700] }
  return { bg: r[100], text: r[900], edge: r[300] }
}
