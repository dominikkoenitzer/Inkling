import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { NOTEBOOK_ICONS, NOTEBOOK_ICON_KEYS } from '@/lib/icons'

export function Button({
  children,
  onClick,
  variant = 'default',
  className = '',
  disabled,
  title,
  type
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  className?: string
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
}): React.JSX.Element {
  const styles = {
    default: 'bg-raised hover:bg-active border border-edge text-ink',
    primary: 'text-white border border-transparent hover:brightness-110',
    ghost: 'hover:bg-hover text-muted hover:text-ink border border-transparent',
    danger: 'bg-raised hover:bg-active border border-edge text-red-400'
  }[variant]
  return (
    <button
      type={type ?? 'button'}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={variant === 'primary' ? { background: 'var(--accent)' } : undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

export function IconBtn({
  children,
  onClick,
  title,
  active,
  className = ''
}: {
  children: ReactNode
  onClick?: (e: React.MouseEvent) => void
  title?: string
  active?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`no-drag inline-flex h-7 w-7 items-center justify-center rounded-md transition-all active:scale-90 ${
        active ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export function Modal({
  title,
  onClose,
  children,
  width = 460
}: {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onMouseDown={onClose}>
      <div
        className="pop-in max-h-[85vh] overflow-y-auto rounded-lg border border-edge bg-panel p-5"
        style={{ width, boxShadow: 'var(--shadow)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconBtn title="Close" onClick={onClose}>
            <X size={16} />
          </IconBtn>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <label className="mb-3 block">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-edge bg-raised px-3 py-1.5 text-sm text-ink placeholder:text-faint focus:border-transparent'

/** Notebook cover glyph picker — monochrome icon grid, "Aa" falls back to initials. */
export function IconPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }): React.JSX.Element {
  return (
    <div className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto rounded-lg border border-edge bg-sunken p-2">
      <button
        type="button"
        title="No icon, use initials"
        onClick={() => onChange(null)}
        className={`flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold transition-transform hover:scale-110 ${
          value === null ? 'bg-active text-ink ring-1 ring-[var(--accent)]' : 'text-muted hover:bg-hover'
        }`}
      >
        Aa
      </button>
      {NOTEBOOK_ICON_KEYS.map((k) => {
        const Icon = NOTEBOOK_ICONS[k]
        return (
          <button
            key={k}
            type="button"
            title={k.replace(/-/g, ' ')}
            onClick={() => onChange(k)}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-transform hover:scale-110 ${
              value === k ? 'bg-active text-ink ring-1 ring-[var(--accent)]' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            <Icon size={16} />
          </button>
        )
      })}
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<{ value: T; label: ReactNode; title?: string }>
  value: T
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="inline-flex rounded-lg border border-edge bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.value ? 'bg-raised text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
