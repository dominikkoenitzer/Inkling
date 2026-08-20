import type React from 'react'
import { NOTEBOOK_ICONS } from '@/lib/icons'

/** Render a notebook's cover glyph, or null when it has none (caller shows initials). */
export function NotebookGlyph({
  icon,
  size = 16,
  className,
  style
}: {
  icon: string | null | undefined
  size?: number
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element | null {
  const Icon = icon ? NOTEBOOK_ICONS[icon] : undefined
  if (!Icon) return null
  return <Icon size={size} className={className} style={style} />
}
