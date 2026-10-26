import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useApp } from '@/stores/app'
import { canTab, closesSheet, TAB_STOPS } from '@/lib/keys'
import { noop, useExit, useReturnFocus, type Exit } from '@/lib/motion'

export function Button({
  children,
  onClick,
  variant = 'default',
  className = '',
  disabled,
  title,
  ariaLabel,
  type,
  ref
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
  ref?: React.Ref<HTMLButtonElement>
}): React.JSX.Element {
  const styles = {
    default: 'bg-raised border border-edge text-ink hover:bg-hover',
    primary: 'bg-accent text-raised border border-transparent hover:brightness-110',
    ghost: 'border border-transparent text-muted hover:bg-hover hover:text-ink',
    danger: 'border border-transparent text-danger hover:bg-hover'
  }[variant]
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium press disabled:cursor-not-allowed disabled:border-edge disabled:bg-panel disabled:text-faint disabled:brightness-100 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

export function IconBtn({
  children,
  onClick,
  title,
  label,
  active,
  className = ''
}: {
  children: ReactNode
  onClick?: (e: React.MouseEvent) => void
  title?: string
  /** A short name for screen readers when the tooltip is long; defaults to the tooltip. */
  label?: string
  /** Set on toggles: shown pressed when true. */
  active?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={label ?? title}
      aria-pressed={active}
      onClick={onClick}
      className={`no-drag inline-flex h-8 w-8 items-center justify-center rounded-md press ${
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
  width = 420,
  closing = false,
  onGone = noop
}: {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
} & Exit): React.JSX.Element {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onExitEnd = useExit(panelRef, closing, onGone)
  // Whatever had focus when the dialog opened gets it back as it starts to close.
  useReturnFocus(closing, panelRef)
  useEffect(() => {
    if (closing) return
    const onKey = (e: KeyboardEvent): void => {
      if (closesSheet(e)) {
        e.preventDefault()
        onClose()
      }
      // Tab stays inside the dialog.
      if (e.key === 'Tab' && panelRef.current) {
        const items = Array.from(panelRef.current.querySelectorAll<HTMLElement & { disabled?: boolean }>(TAB_STOPS)).filter(canTab)
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
  }, [onClose, closing, panelRef])
  return (
    // A closing dialog sits under anything that opens in its place and takes no input.
    <div
      className={`no-drag fixed inset-0 flex items-center justify-center p-6 ${closing ? 'pointer-events-none z-40' : 'z-50'}`}
      inert={closing || undefined}
      // The press itself must not move focus, or it lands on the page instead of the opener.
      onMouseDown={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        ref={panelRef}
        role={closing ? undefined : 'dialog'}
        aria-modal={closing ? undefined : 'true'}
        aria-labelledby={titleId}
        tabIndex={-1}
        data-sheet=""
        data-closing={closing || undefined}
        onAnimationEnd={onExitEnd}
        className="motion-sheet max-h-[85vh] overflow-y-auto rounded-lg border border-edge bg-raised p-5"
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
export function Toaster(): React.JSX.Element {
  const current = useApp((s) => s.toast)
  const dismiss = useApp((s) => s.dismissToast)
  // The last toast stays for its exit once it is dismissed; a new one replaces it at once.
  const [toast, setToast] = useState(current)
  if (current && current !== toast) setToast(current)
  const closing = !current && !!toast
  const toastRef = useRef<HTMLDivElement>(null)
  const onExitEnd = useExit(toastRef, closing, useCallback(() => setToast(null), []))
  return (
    <>
      {/* Screen readers follow a region that is always there and holds only the words. */}
      <div role="status" className="sr-only">
        {current?.message ?? ''}
      </div>
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
          <div
            key={toast.id}
            ref={toastRef}
            data-toast=""
            inert={closing || undefined}
            data-closing={closing || undefined}
            onAnimationEnd={onExitEnd}
            className={`motion-rise flex items-center gap-3 rounded-lg border border-edge bg-raised py-1.5 pl-4 pr-1.5 text-sm ${closing ? '' : 'pointer-events-auto'}`}
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
                className="press rounded-md px-2 py-1 text-sm font-medium text-accent-text hover:bg-hover"
              >
                {toast.actionLabel}
              </button>
            )}
            <IconBtn title="Dismiss" onClick={dismiss} className="h-7 w-7">
              <X size={14} />
            </IconBtn>
          </div>
        </div>
      )}
    </>
  )
}

/** Something to type, shown as a small solid chip. */
export function Code({ children }: { children: ReactNode }): React.JSX.Element {
  return <code className="rounded border border-edge bg-panel px-1 font-mono text-[13px] text-ink">{children}</code>
}

/** A key to press, as a small solid chip. */
export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <kbd className={`inline-flex h-5 min-w-5 items-center justify-center rounded border border-edge bg-panel px-1.5 font-sans text-xs text-muted ${className}`}>
      {children}
    </kbd>
  )
}

/**
 * A big editable title. A textarea that grows with its text, so a long title wraps; the
 * padding gives descenders and accents room inside the clip box and the margin takes it back.
 */
export const titleFieldCls =
  'font-display block w-full resize-none overflow-hidden bg-transparent field-sizing-content -my-[0.25em] py-[0.25em] text-[32px] font-semibold leading-tight tracking-tight'

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
          className={`press rounded-[5px] px-3 py-1 text-sm ${
            value === o.value ? 'bg-raised font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
