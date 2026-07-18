import type { ColorKey } from '@shared/types'
import type { CSSProperties } from 'react'

type Ramp = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>

/** 7+ stop ramps per brand color (§11) — 50/100 for backgrounds, 600+ for text/borders. */
export const RAMPS: Record<ColorKey, Ramp> = {
  teal: {
    50: '#E7F7F0',
    100: '#CFEFE2',
    200: '#A3E0C8',
    300: '#6FCCA9',
    400: '#3DB58B',
    500: '#1D9E75',
    600: '#15805F',
    700: '#0F6E56',
    800: '#0A4A3A',
    900: '#06332A'
  },
  coral: {
    50: '#FCEEE8',
    100: '#F9DCD1',
    200: '#F2B9A4',
    300: '#E99172',
    400: '#E07348',
    500: '#D85A30',
    600: '#B44724',
    700: '#8F381D',
    800: '#6A2A16',
    900: '#4A1B0C'
  },
  amber: {
    50: '#F9F1E4',
    100: '#F3E2C7',
    200: '#E6C48F',
    300: '#D8A559',
    400: '#C98B32',
    500: '#BA7517',
    600: '#985F11',
    700: '#784B0E',
    800: '#58370A',
    900: '#412402'
  },
  pink: {
    50: '#FBEDF2',
    100: '#F7D9E3',
    200: '#EFB3C7',
    300: '#E48CA8',
    400: '#DC6D91',
    500: '#D4537E',
    600: '#B23D66',
    700: '#8E2F50',
    800: '#67223A',
    900: '#471627'
  },
  gray: {
    50: '#F4F4F2',
    100: '#E7E7E3',
    200: '#D0CFC9',
    300: '#B5B4AC',
    400: '#9E9D95',
    500: '#888780',
    600: '#6E6D66',
    700: '#57564F',
    800: '#403F3A',
    900: '#2B2A26'
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
      '--accent-text': r[300]
    } as CSSProperties
  }
  return {
    '--accent': r[500],
    '--accent-soft': r[100],
    '--accent-text': r[700]
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
