import { Input } from 'antd'
import { Check, History, Search } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommandDispatchTask } from '#entities/command-dispatch'
import { FilterPopover } from '#shared/ui'
import styles from './CommandDispatchHistory.module.scss'

interface CommandDispatchHistoryProps {
  tasks: CommandDispatchTask[]
  selectedTaskId?: string
  onSelect: (taskId: string) => void
}

export function CommandDispatchHistory({ tasks, selectedTaskId, onSelect }: CommandDispatchHistoryProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeAndFocusTrigger = () => {
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }
  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeAndFocusTrigger()
  }
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = tasks.filter(task => task.command.toLocaleLowerCase().includes(normalizedQuery))
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }), [i18n.language])
  const formatTime = (value: string) => {
    const date = new Date(value)
    return Number.isFinite(date.getTime())
      ? timeFormatter.format(date)
      : ''
  }
  return (
    <FilterPopover
      open={open}
      onOpenChange={setOpen}
      content={
        <section className={styles.panel} aria-label={t('commandDispatch.taskList')} onKeyDown={handleEscape}>
          <div className={styles.toolbar}>
            <header className={styles.header}>
              <span className={styles.heading}><History size={14} aria-hidden="true" /><strong>{t('commandDispatch.taskList')}</strong></span>
              <span className={styles.total}>{tasks.length}</span>
            </header>
            <Input
              className={styles.search}
              prefix={<Search size={13} aria-hidden="true" />}
              value={query}
              allowClear
              placeholder={t('commandDispatch.searchHistory')}
              aria-label={t('commandDispatch.searchHistory')}
              onChange={event => setQuery(event.target.value)}
            />
          </div>
          <div className={styles.list}>
            {filtered.map(task => (
              <button
                key={task.id}
                type="button"
                className={styles.item}
                aria-current={task.id === selectedTaskId ? 'true' : undefined}
                onClick={() => {
                  onSelect(task.id)
                  closeAndFocusTrigger()
                }}
              >
                <span className={styles.command}>
                  <code>{task.command}</code>
                  <Check size={13} className={styles.check} aria-hidden="true" />
                </span>
                <span className={styles.meta}>
                  <span className={styles.details}>
                    <span data-status={task.status}>{t(`commandDispatch.status.${task.status}`)}</span>
                    <small>{t('commandDispatch.targetCount', { count: task.total_targets })}</small>
                  </span>
                  <time dateTime={task.created_at}>{formatTime(task.created_at)}</time>
                </span>
              </button>
            ))}
            {!filtered.length ? <p className={styles.empty}>{t('commandDispatch.noHistoryMatches')}</p> : null}
          </div>
        </section>
      }
    >
      <button ref={triggerRef} type="button" className={styles.trigger} aria-expanded={open} aria-label={t('commandDispatch.taskList')} onKeyDownCapture={handleEscape}>
        <History size={15} aria-hidden="true" />
        <span>{t('commandDispatch.taskList')}</span>
        <small>{tasks.length}</small>
      </button>
    </FilterPopover>
  )
}
