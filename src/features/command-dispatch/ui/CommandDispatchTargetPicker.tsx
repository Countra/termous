import { Button, Checkbox, Input } from 'antd'
import { ListChecks, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FilterPopover } from '#shared/ui'
import type { CommandDispatchSessionOption } from '../model/commandDispatchSelection'
import styles from './CommandDispatchDock.module.scss'

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
  const visibleOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return normalizedQuery
      ? options.filter((option) => option.searchValue.includes(normalizedQuery))
      : options
  }, [options, query])
  const content = (
    <div className={styles['target-popover']} data-command-dispatch-target-popover="">
      <header className={styles['target-popover-head']}>
        <span>{t('commandDispatch.targetPickerTitle')}</span>
        <strong>{selectedSessionIds.size} / {options.length}</strong>
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
      <div className={styles['target-popover-list']}>
        {visibleOptions.map((option) => (
          <label className={styles['target-option']} key={option.sessionId}>
            <Checkbox
              checked={selectedSessionIds.has(option.sessionId)}
              onChange={(event) => {
                const next = new Set(selectedSessionIds)
                if (event.target.checked) next.add(option.sessionId)
                else next.delete(option.sessionId)
                onChange(next)
              }}
            />
            <span>
              <strong>{option.sessionName}</strong>
              {option.hostName.trim() !== option.sessionName.trim()
                ? <small>{option.hostName}</small>
                : null}
              <small>{option.endpoint}</small>
            </span>
          </label>
        ))}
        {visibleOptions.length === 0 ? (
          <span className={styles['target-popover-empty']}>{t('commandDispatch.noMatchingTargets')}</span>
        ) : null}
      </div>
      <footer className={styles['target-popover-actions']}>
        <Button type="text" size="small" onClick={() => onChange(new Set(options.map((option) => option.sessionId)))}>
          {t('commandDispatch.selectAll')}
        </Button>
        <Button type="text" size="small" onClick={() => onChange(new Set())}>
          {t('commandDispatch.clearSelection')}
        </Button>
      </footer>
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
        type="button"
        className={styles['target-picker-trigger']}
        aria-expanded={open}
        data-command-dispatch-target-picker=""
      >
        <ListChecks size={14} aria-hidden="true" />
        <span>{t('commandDispatch.selectedCount', { count: selectedSessionIds.size })}</span>
      </button>
    </FilterPopover>
  )
}
