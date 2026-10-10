import type { ColorKey } from '@shared/types'
import { RAMPS } from '@/lib/colors'

const BODY = 'M60 10 C 90 45, 105 70, 105 95 C 105 120, 85 140, 60 140 C 35 140, 15 120, 15 95 C 15 70, 30 45, 60 10 Z'

/** Inky, the app mascot, drawn as a still image. */
export function Inky({ color = 'teal', size = 96, className = '' }: { color?: ColorKey; size?: number; className?: string }): React.JSX.Element {
  const r = RAMPS[color]
  const face = r[900]
  const cheek = r[300]

  return (
    <svg
      viewBox="-12 0 144 150"
      width={size}
      height={(size * 150) / 144}
      className={className}
      role="img"
      aria-label="Inky the mascot"
    >
      <path d={BODY} fill={r[500]} />

      {/* arms */}
      <path d="M15 100 Q0 108, 8 122" stroke={r[500]} strokeWidth="10" fill="none" strokeLinecap="round" />
      <path d="M105 100 Q120 108, 112 122" stroke={r[500]} strokeWidth="10" fill="none" strokeLinecap="round" />

      {/* cheeks */}
      <ellipse cx="30" cy="108" rx="7" ry="4" fill={cheek} opacity="0.6" />
      <ellipse cx="90" cy="108" rx="7" ry="4" fill={cheek} opacity="0.6" />

      {/* eyes */}
      <circle cx="42" cy="95" r="10" fill="#ffffff" />
      <circle cx="78" cy="95" r="10" fill="#ffffff" />
      <circle cx="45" cy="93" r="3" fill={face} />
      <circle cx="81" cy="93" r="3" fill={face} />

      {/* mouth */}
      <path d="M50 115 Q60 122, 70 115" stroke={face} strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The app logo mark: Inky's head, sharing the exact `BODY` path as the mascot
 * so the brand and the character are the same thing.
 *
 * Genuinely tinted by the live accent: it fills from `--accent` / `--accent-ink`
 * (set by `accentVars`), so it follows teal/coral/amber/pink/gray like the rest
 * of the UI instead of being hardcoded. Pass `color` to pin it to one ramp.
 *
 * Below 24px the mouth and cheeks are dropped; at 16px they turn to mud and the
 * silhouette plus two eyes is what actually reads.
 */
export function LogoMark({
  size = 26,
  color
}: {
  size?: number
  color?: ColorKey
}): React.JSX.Element {
  const body = color ? RAMPS[color][500] : 'var(--accent, #10A37F)'
  const ink = color ? RAMPS[color][900] : 'var(--accent-ink, #043227)'
  const detailed = size >= 24

  return (
    <svg viewBox="-10 5 140 140" width={size} height={size} role="img" aria-label="Inkling">
      <path d={BODY} fill={body} />

      {detailed && (
        <>
          <ellipse cx="30" cy="108" rx="7" ry="4" fill="#ffffff" opacity="0.28" />
          <ellipse cx="90" cy="108" rx="7" ry="4" fill="#ffffff" opacity="0.28" />
        </>
      )}

      <circle cx="42" cy="95" r="10" fill="#ffffff" />
      <circle cx="78" cy="95" r="10" fill="#ffffff" />
      <circle cx="44" cy="94" r="3.6" fill={ink} />
      <circle cx="80" cy="94" r="3.6" fill={ink} />

      {detailed && (
        <path
          d="M50 116 Q60 123, 70 116"
          stroke={ink}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

/** Friendly empty-state block used across all four pillars. */
export function EmptyState({
  color = 'teal',
  title,
  hint,
  action
}: {
  color?: ColorKey
  title: string
  hint?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center fade-up">
      <Inky color={color} size={104} />
      <div className="text-lg font-semibold">{title}</div>
      {hint && <div className="max-w-sm text-muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
