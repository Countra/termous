import { Check, ChevronDown } from 'lucide-react'
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'

export interface SelectOption {
  value: string
  label: string
  description?: string
}

interface CustomSelectProps {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
}

export function CustomSelect({ label, value, options, onChange, disabled = false }: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const selected = useMemo(() => options.find((option) => option.value === value) ?? options[0], [options, value])

  useEffect(() => {
    const index = options.findIndex((option) => option.value === selected?.value)
    setActiveIndex(index < 0 ? 0 : index)
  }, [options, selected?.value])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const choose = (option: SelectOption) => {
    onChange(option.value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => {
        const delta = event.key === 'ArrowDown' ? 1 : -1
        return (current + delta + options.length) % options.length
      })
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) {
        choose(options[activeIndex])
      } else {
        setOpen(true)
      }
    }
    if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="custom-select" ref={rootRef}>
      <span className="field-label">{label}</span>
      <button
        ref={buttonRef}
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span>{selected?.label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="select-menu" role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              className={`select-option ${option.value === value ? 'is-selected' : ''} ${
                index === activeIndex ? 'is-active' : ''
              }`}
              role="option"
              aria-selected={option.value === value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span>
                {option.label}
                {option.description ? <small>{option.description}</small> : null}
              </span>
              {option.value === value ? <Check size={15} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

