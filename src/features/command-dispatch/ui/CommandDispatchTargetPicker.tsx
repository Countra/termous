import { Checkbox, Input } from 'antd'
import { ChevronDown, ListChecks, Search } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { FilterPopover } from '#shared/ui'
import type { CommandDispatchSessionOption } from '../model/commandDispatchSelection'
import styles from './CommandDispatchTargetPicker.module.scss'

interface CommandDispatchTargetPickerProps {
  options: CommandDispatchSessionOption[]
  selectedSessionIds: ReadonlySet<string>
  onChange: (sessionIds: ReadonlySet<string>) => void
}

export function CommandDispatchTargetPicker({
  options,
  selectedSessionIds,
  onChange,
}: CommandDispatchTargetPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }
  const selectedCount = options.filter((option) => selectedSessionIds.has(option.sessionId)).length
  const visibleOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return normalizedQuery
      ? options.filter((option) => option.searchValue.includes(normalizedQuery))
      : options
  }, [options, query])
  const content = (
    <div className={styles['target-popover']} data-command-dispatch-target-popover="" onKeyDown={handleEscape}>
      <header className={styles['target-popover-head']}>
        <span>{t('commandDispatch.targetPickerTitle')}</span>
        <strong>{selectedCount} / {options.length}</strong>
      </header>
      <Input
        value={query}
        className={styles['target-popover-search']}
        prefix={<Search size={13} aria-hidden="true" />}
        allowClear
        aria-label={t('commandDispatch.searchTargets')}
        placeholder={t('commandDispatch.searchTargets')}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={styles['target-popover-bulk']}>
        <Checkbox
          checked={options.length > 0 && selectedCount === options.length}
          indeterminate={selectedCount > 0 && selectedCount < options.length}
          disabled={options.length === 0}
          onChange={(event) => onChange(event.target.checked ? new Set(options.map((option) => option.sessionId)) : new Set())}
        >
          {t('commandDispatch.selectAll')}
        </Checkbox>
        <span>{t('commandDispatch.targetCount', { count: options.length })}</span>
      </div>
      <div className={styles['target-popover-list']}>
        {visibleOptions.map((option) => (
          <Checkbox
            key={option.sessionId}
            className={styles['target-option']}
            checked={selectedSessionIds.has(option.sessionId)}
            onChange={(event) => {
              const next = new Set(selectedSessionIds)
              if (event.target.checked) next.add(option.sessionId)
              else next.delete(option.sessionId)
              onChange(next)
            }}
          >
            <span className={styles['target-option-copy']}>
              <strong>{option.sessionName}</strong>
              {option.hostName.trim() !== option.sessionName.trim()
                ? <small>{option.hostName}</small>
                : null}
              <small>{option.endpoint}</small>
            </span>
          </Checkbox>
        ))}
        {visibleOptions.length === 0 ? (
          <span className={styles['target-popover-empty']}>{t('commandDispatch.noMatchingTargets')}</span>
        ) : null}
      </div>
      <p className={styles['target-popover-hint']}>{t('commandDispatch.connectedTargetsOnly')}</p>
    </div>
  )
  return (
    <FilterPopover
      open={open}
      placement="bottom"
      content={content}
      onOpenChange={setOpen}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles['target-picker-trigger']}
        aria-expanded={open}
        aria-label={t('commandDispatch.selectedCount', { count: selectedCount })}
        data-command-dispatch-target-picker=""
        onKeyDownCapture={handleEscape}
      >
        <ListChecks size={14} aria-hidden="true" />
        <span>{t('commandDispatch.selectedCount', { count: selectedCount })}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </FilterPopover>
  )
}
