import {
  BookOpen,
  GraduationCap,
  PenTool,
  BookText,
  Calculator,
  FlaskConical,
  Atom,
  Dna,
  Microscope,
  Globe,
  Map,
  Landmark,
  Scale,
  Languages,
  Code,
  Cpu,
  Bot,
  TrendingUp,
  DollarSign,
  Briefcase,
  Palette,
  Music,
  Film,
  Camera,
  Gamepad2,
  Dumbbell,
  Trophy,
  Brain,
  Lightbulb,
  Rocket,
  Leaf,
  Coffee,
  NotebookPen
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** Cover glyphs a notebook can pick — clean monochrome icons in the app's own icon family. */
export const NOTEBOOK_ICONS: Record<string, LucideIcon> = {
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  'pen-tool': PenTool,
  'book-text': BookText,
  calculator: Calculator,
  flask: FlaskConical,
  atom: Atom,
  dna: Dna,
  microscope: Microscope,
  globe: Globe,
  map: Map,
  landmark: Landmark,
  scale: Scale,
  languages: Languages,
  code: Code,
  cpu: Cpu,
  bot: Bot,
  'trending-up': TrendingUp,
  'dollar-sign': DollarSign,
  briefcase: Briefcase,
  palette: Palette,
  music: Music,
  film: Film,
  camera: Camera,
  gamepad: Gamepad2,
  dumbbell: Dumbbell,
  trophy: Trophy,
  brain: Brain,
  lightbulb: Lightbulb,
  rocket: Rocket,
  leaf: Leaf,
  coffee: Coffee
}

export const NOTEBOOK_ICON_KEYS = Object.keys(NOTEBOOK_ICONS)

/** The journal notebook's fallback glyph when it has no explicit cover. */
export const JournalIcon = NotebookPen

export function hasGlyph(icon: string | null | undefined): boolean {
  return !!icon && icon in NOTEBOOK_ICONS
}

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
