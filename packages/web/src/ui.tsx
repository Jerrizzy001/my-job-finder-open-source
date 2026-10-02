import { useId, useState, type ReactNode } from 'react'

/** Icons: one stroke family, 20px grid, 1.6 stroke. Drawn here, not borrowed glyphs. */
const PATHS = {
  thumbDown: 'M7 4h7.5a2 2 0 0 1 2 1.7l.9 6a2 2 0 0 1-2 2.3H12l.6 3a1.6 1.6 0 0 1-3 .9L7 13M7 4v9M7 4H4.5v9H7',
  external: 'M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5',
  file: 'M6 3h5.5L15 6.5V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM11 3v4h4',
  sparkle: 'M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  refresh: 'M16 6.5A6.5 6.5 0 1 0 16.5 12M16 3v3.5h-3.5',
  sun: 'M10 6.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1.1 1.1M14.6 14.6l1.1 1.1M15.7 4.3l-1.1 1.1M5.4 14.6l-1.1 1.1',
  moon: 'M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8Z',
  close: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
  back: 'M12 4.5 6.5 10l5.5 5.5',
  undo: 'M7 7H12a4 4 0 0 1 0 8H8M7 7l3-3M7 7l3 3',
  plus: 'M10 4.5v11M4.5 10h11',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d={PATHS[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type ButtonProps = {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'quiet' | 'danger'
  icon?: IconName
  disabled?: boolean
  busy?: boolean
  type?: 'button' | 'submit'
  title?: string
  ariaKeyshortcuts?: string
}

export function Button({
  children,
  onClick,
  variant = 'quiet',
  icon,
  disabled,
  busy,
  type = 'button',
  title,
  ariaKeyshortcuts,
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}`}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      title={title}
      aria-keyshortcuts={ariaKeyshortcuts}
    >
      {icon && <Icon name={busy ? 'refresh' : icon} />}
      <span>{children}</span>
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

/** A list of short strings: chips you can remove, and an input that adds one on Enter. */
export function ListEditor({
  label,
  hint,
  values,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const id = useId()
  const add = () => {
    const value = draft.trim()
    if (value && !values.some((existing) => existing.toLowerCase() === value.toLowerCase()))
      onChange([...values, value])
    setDraft('')
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="chips">
        {values.map((value) => (
          <span className="chip" key={value}>
            {value}
            <button
              type="button"
              className="chip-x"
              onClick={() => onChange(values.filter((v) => v !== value))}
              aria-label={`Remove ${value}`}
            >
              <Icon name="close" size={14} />
            </button>
          </span>
        ))}
        <input
          id={id}
          className="chip-input"
          value={draft}
          placeholder={values.length ? 'Add another' : placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              add()
            } else if (event.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1))
          }}
          onBlur={add}
        />
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

export function Notice({ tone, children }: { tone: 'ok' | 'error' | 'info'; children: ReactNode }) {
  return (
    <p className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  )
}
