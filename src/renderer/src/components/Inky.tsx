import { useRef, useState } from 'react'
import type { ColorKey } from '@shared/types'
import { RAMPS } from '@/lib/colors'

export type InkyPose = 'neutral' | 'wave' | 'sleepy' | 'happy'

interface InkyProps {
  pose?: InkyPose
  color?: ColorKey
  size?: number
  className?: string
}

const BODY = 'M60 10 C 90 45, 105 70, 105 95 C 105 120, 85 140, 60 140 C 35 140, 15 120, 15 95 C 15 70, 30 45, 60 10 Z'

/**
 * Inky — the app's mascot (§11). Pure SVG + CSS: idle bob, randomized blink,
 * pupils track the cursor on hover, squash-and-stretch on click, hop when happy.
 * Reads state only; never blocks anything.
 */
export function Inky({ pose = 'neutral', color = 'teal', size = 96, className = '' }: InkyProps): React.JSX.Element {
  const r = RAMPS[color]
  const face = r[900]
  const cheek = r[300]
  const svgRef = useRef<SVGSVGElement>(null)
  const [pupil, setPupil] = useState({ x: 0, y: 0 })
  const [clicked, setClicked] = useState(false)
  const [blinkDur] = useState(() => `${(4 + Math.random() * 3).toFixed(2)}s`)

  const onMove = (e: React.MouseEvent): void => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height * 0.62
    const dx = Math.max(-3, Math.min(3, (e.clientX - cx) / 18))
    const dy = Math.max(-3, Math.min(3, (e.clientY - cy) / 18))
    setPupil({ x: dx, y: dy })
  }

  const onClick = (): void => {
    setClicked(true)
    setTimeout(() => setClicked(false), 320)
  }

  const wrapClass = `inky ${clicked ? 'inky-clicked' : ''} ${pose === 'happy' ? 'inky-happy' : ''} ${className}`

  return (
    <svg
      ref={svgRef}
      viewBox="-12 0 144 150"
      width={size}
      height={(size * 150) / 144}
      className={wrapClass}
      style={{ '--blink-dur': blinkDur } as React.CSSProperties}
      onMouseMove={onMove}
      onMouseLeave={() => setPupil({ x: 0, y: 0 })}
      onMouseDown={onClick}
      role="img"
      aria-label={`Inky the mascot, ${pose}`}
    >
      <g className="inky-body">
        <path d={BODY} fill={r[500]} />

        {/* arms */}
        {pose === 'wave' ? (
          <path className="inky-wave-arm" d="M15 100 Q-5 85, 5 70" stroke={r[500]} strokeWidth="10" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M15 100 Q0 108, 8 122" stroke={r[500]} strokeWidth="10" fill="none" strokeLinecap="round" />
        )}
        <path d="M105 100 Q120 108, 112 122" stroke={r[500]} strokeWidth="10" fill="none" strokeLinecap="round" />

        {/* cheeks */}
        {pose !== 'sleepy' && (
          <>
            <ellipse cx="30" cy="108" rx="7" ry="4" fill={cheek} opacity="0.6" />
            <ellipse cx="90" cy="108" rx="7" ry="4" fill={cheek} opacity="0.6" />
          </>
        )}

        {/* eyes */}
        {pose === 'neutral' && (
          <g className="inky-eyes">
            <circle cx="42" cy="95" r="10" fill="#ffffff" />
            <circle cx="78" cy="95" r="10" fill="#ffffff" />
            <g className="inky-pupils" style={{ transform: `translate(${pupil.x}px, ${pupil.y}px)` }}>
              <circle cx="45" cy="93" r="3" fill={face} />
              <circle cx="81" cy="93" r="3" fill={face} />
            </g>
          </g>
        )}
        {(pose === 'wave' || pose === 'happy') && (
          <g>
            <circle cx="42" cy="93" r="10" fill="#ffffff" />
            <circle cx="78" cy="93" r="10" fill="#ffffff" />
            <path d="M39 90 Q42 86, 45 90" stroke={face} strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M75 90 Q78 86, 81 90" stroke={face} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </g>
        )}
        {pose === 'sleepy' && (
          <g>
            <path d="M35 93 Q42 98, 49 93" stroke={face} strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M71 93 Q78 98, 85 93" stroke={face} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </g>
        )}

        {/* mouth */}
        {pose === 'neutral' && <path d="M50 115 Q60 122, 70 115" stroke={face} strokeWidth="2.5" fill="none" strokeLinecap="round" />}
        {(pose === 'wave' || pose === 'happy') && (
          <path d="M48 112 Q60 128, 72 112" stroke={face} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        )}
        {pose === 'sleepy' && <circle cx="60" cy="118" r="5" fill={face} />}
      </g>

      {pose === 'sleepy' && (
        <text x="88" y="45" fontFamily="sans-serif" fontSize="16" fill="currentColor" opacity="0.55">
          z z
        </text>
      )}
    </svg>
  )
}

/**
 * The app logo mark — Inky's head, sharing the exact `BODY` path as the mascot
 * so the brand and the character are the same thing.
 *
 * Genuinely tinted by the live accent: it fills from `--accent` / `--accent-ink`
 * (set by `accentVars`), so it follows teal/coral/amber/pink/gray like the rest
 * of the UI instead of being hardcoded. Pass `color` to pin it to one ramp.
 *
 * Below 24px the mouth and cheeks are dropped — at 16px they turn to mud and the
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
  pose = 'neutral',
  color = 'teal',
  title,
  hint,
  action
}: {
  pose?: InkyPose
  color?: ColorKey
  title: string
  hint?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center fade-up">
      <Inky pose={pose} color={color} size={104} />
      <div className="text-lg font-semibold">{title}</div>
      {hint && <div className="max-w-sm text-muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
