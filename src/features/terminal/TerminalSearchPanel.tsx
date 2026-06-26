import { Button, Tooltip } from 'antd'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TerminalSearchResult } from './terminalRuntimeContext'

interface TerminalSearchPanelProps {
  value: string
  caseSensitive: boolean
  regex: boolean
  result: TerminalSearchResult
  onChange: (value: string) => void
  onPrevious: () => void
  onNext: () => void
  onToggleCase: () => void
  onToggleRegex: () => void
  onClose: () => void
}

export function TerminalSearchPanel({
  value,
  caseSensitive,
  regex,
  result,
  onChange,
  onPrevious,
  onNext,
  onToggleCase,
  onToggleRegex,
  onClose,
}: TerminalSearchPanelProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const hasError = result.error === 'invalid_regex'
  const countLabel = hasError ? t('terminal.regexError') : formatSearchCount(result)

  useEffect(() => {
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [])

  useEffect(() => {
    const input = inputRef.current
    if (!input) {
      return undefined
    }
    const syncValue = () => {
      onChange(input.value)
    }
    input.addEventListener('input', syncValue)
    input.addEventListener('keyup', syncValue)
    return () => {
      input.removeEventListener('input', syncValue)
      input.removeEventListener('keyup', syncValue)
    }
  }, [onChange])

  return (
    <div
      className={`terminal-search-panel ${hasError ? 'is-error' : ''}`}
      role="search"
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        className={`terminal-search-input ${hasError ? 'is-error' : ''}`}
        value={value}
        type="search"
        name="terminal-search"
        autoComplete="off"
        spellCheck={false}
        placeholder={t('terminal.searchPlaceholder')}
        aria-label={t('terminal.searchPlaceholder')}
        aria-invalid={hasError}
        onChange={(event) => onChange(event.target.value)}
        onInput={(event) => onChange(event.currentTarget.value)}
        onKeyUp={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            if (event.shiftKey) {
              onPrevious()
            } else {
              onNext()
            }
          }
        }}
      />
      <span className="terminal-search-count" aria-live="polite">
        {countLabel}
      </span>
      <Tooltip title={t('terminal.previousMatch')}>
        <Button
          type="text"
          className="terminal-search-button"
          aria-label={t('terminal.previousMatch')}
          icon={<ChevronUp size={15} />}
          onClick={onPrevious}
        />
      </Tooltip>
      <Tooltip title={t('terminal.nextMatch')}>
        <Button
          type="text"
          className="terminal-search-button"
          aria-label={t('terminal.nextMatch')}
          icon={<ChevronDown size={15} />}
          onClick={onNext}
        />
      </Tooltip>
      <Tooltip title={t('terminal.matchCase')}>
        <Button
          type="text"
          className={`terminal-search-button terminal-search-toggle ${caseSensitive ? 'is-active' : ''}`}
          aria-label={t('terminal.matchCase')}
          aria-pressed={caseSensitive}
          onClick={onToggleCase}
        >
          Aa
        </Button>
      </Tooltip>
      <Tooltip title={t('terminal.useRegex')}>
        <Button
          type="text"
          className={`terminal-search-button terminal-search-toggle ${regex ? 'is-active' : ''}`}
          aria-label={t('terminal.useRegex')}
          aria-pressed={regex}
          onClick={onToggleRegex}
        >
          .*
        </Button>
      </Tooltip>
      <Tooltip title={t('app.close')}>
        <Button
          type="text"
          className="terminal-search-button terminal-search-close"
          aria-label={t('app.close')}
          icon={<X size={15} />}
          onClick={onClose}
        />
      </Tooltip>
    </div>
  )
}

function formatSearchCount(result: TerminalSearchResult) {
  if (result.resultCount <= 0) {
    return '0 / 0'
  }
  const current = result.resultIndex >= 0 ? result.resultIndex + 1 : '-'
  return `${current} / ${result.resultCount}`
}
