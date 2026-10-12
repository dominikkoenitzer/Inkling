const BODY = 'M60 10 C 90 45, 105 70, 105 95 C 105 120, 85 140, 60 140 C 35 140, 15 120, 15 95 C 15 70, 30 45, 60 10 Z'

/** Inky, the mascot: an ink drop in the theme's accent. */
export function Inky({ size = 56, className = '' }: { size?: number; className?: string }): React.JSX.Element {
  return (
    <svg viewBox="-12 0 144 150" width={size} height={(size * 150) / 144} className={className} aria-hidden>
      <path d={BODY} fill="var(--accent)" />
      <path d="M15 100 Q0 108, 8 122" stroke="var(--accent)" strokeWidth="10" fill="none" strokeLinecap="round" />
      <path d="M105 100 Q120 108, 112 122" stroke="var(--accent)" strokeWidth="10" fill="none" strokeLinecap="round" />
      <circle cx="42" cy="95" r="10" fill="#ffffff" />
      <circle cx="78" cy="95" r="10" fill="#ffffff" />
      <circle cx="45" cy="93" r="3.2" fill="var(--accent-ink)" />
      <circle cx="81" cy="93" r="3.2" fill="var(--accent-ink)" />
      <path d="M50 115 Q60 122, 70 115" stroke="var(--accent-ink)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/** The logo mark: Inky's head. Below 24px only the drop and the eyes stay. */
export function LogoMark({ size = 26 }: { size?: number }): React.JSX.Element {
  const detailed = size >= 24
  return (
    <svg viewBox="-10 5 140 140" width={size} height={size} role="img" aria-label="Inkling">
      <path d={BODY} fill="var(--accent)" />
      <circle cx="42" cy="95" r="10" fill="#ffffff" />
      <circle cx="78" cy="95" r="10" fill="#ffffff" />
      <circle cx="44" cy="94" r="3.6" fill="var(--accent-ink)" />
      <circle cx="80" cy="94" r="3.6" fill="var(--accent-ink)" />
      {detailed && <path d="M50 116 Q60 123, 70 116" stroke="var(--accent-ink)" strokeWidth="3" fill="none" strokeLinecap="round" />}
    </svg>
  )
}

/** A quiet empty state: a small Inky, one line, an optional hint and action. */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Inky size={44} className="mb-2" />
      <div className="text-[15px] font-medium text-ink">{title}</div>
      {hint && <div className="max-w-sm text-sm text-muted">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
