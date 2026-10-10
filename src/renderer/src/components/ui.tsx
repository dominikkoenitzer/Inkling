import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useId, useRef } from 'react'
import { useApp } from '@/stores/app'

export function Button({
  children,
  onClick,
  variant = 'default',
  className = '',
  disabled,
  title,
  ariaLabel,
  type
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  className?: string
  disabled?: boolean
  title?: string
  /** Needed when the children are only an icon. */
  ariaLabel?: string
  type?: 'button' | 'submit'
}): React.JSX.Element {
  const styles = {
    default: 'bg-raised border border-edge text-ink hover:bg-hover',
    primary: 'bg-accent text-raised border border-transparent hover:brightness-110',
    ghost: 'border border-transparent text-muted hover:bg-hover hover:text-ink',
    danger: 'border border-transparent text-danger hover:bg-hover'
  }[variant]
  return (
    <button
      type={type ?? 'button'}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${styles} ${className}`}
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
      className={`no-drag inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
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
  width = 420
}: {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}): React.JSX.Element {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Whatever had focus when the dialog opened gets it back when it closes.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      // Tab stays inside the dialog.
      if (e.key === 'Tab' && panelRef.current) {
        const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])'))
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    // An autofocused field inside keeps its focus; otherwise the dialog itself takes it.
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus()
    return () => {
      if (opener.current?.isConnected) opener.current.focus()
    }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[85vh] overflow-y-auto rounded-lg border border-edge bg-raised p-5"
        style={{ width, boxShadow: 'var(--shadow)', outline: 'none' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-display text-base font-semibold">
            {title}
          </h2>
          <IconBtn title="Close" onClick={onClose}>
            <X size={16} />
          </IconBtn>
        </div>
        {children}
      </div>
    </div>
  )
}

/** One transient message at a time, bottom-centre. Used for "that's undoable". */
export function Toaster(): React.JSX.Element | null {
  const toast = useApp((s) => s.toast)
  const dismiss = useApp((s) => s.dismissToast)
  if (!toast) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-3 rounded-lg border border-edge bg-raised py-1.5 pl-4 pr-1.5 text-sm"
        style={{ boxShadow: 'var(--shadow)' }}
      >
        <span className="text-ink">{toast.message}</span>
        {toast.actionLabel && toast.onAction && (
          <button
            type="button"
            onClick={() => {
              toast.onAction?.()
              dismiss()
            }}
            className="rounded-md px-2 py-1 text-sm font-medium text-accent-text transition-colors hover:bg-hover"
          >
            {toast.actionLabel}
          </button>
        )}
        <IconBtn title="Dismiss" onClick={dismiss} className="h-7 w-7">
          <X size={14} />
        </IconBtn>
      </div>
    </div>
  )
}

export const inputCls =
  'w-full rounded-md border border-edge bg-raised px-3 py-1.5 text-sm text-ink placeholder:text-faint focus:border-accent'

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
    <div className="inline-flex rounded-md bg-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-[5px] px-3 py-1 text-sm transition-colors ${
            value === o.value ? 'bg-raised font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
