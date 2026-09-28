import { Button, Input } from 'antd'
import { Filter, Search } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditSearchField } from '#entities/audit'
import { CustomSelect, DateTimePicker, FilterPopover } from '#shared/ui'
import { auditScopes } from '../model/auditLabels.ts'
import { useAuditFilters, type AuditFilterValues } from '../model/useAuditFilters.ts'
import styles from './AuditWorkspace.module.scss'

const searchFields: AuditSearchField[] = ['all', 'command', 'path', 'actor', 'target', 'identifier', 'summary', 'action']

export function AuditFilters({ onChange }: { onChange: (values: AuditFilterValues) => void }) {
  const { t } = useTranslation()
  const { draft, change, textInput, reset, hasFilters } = useAuditFilters(onChange)
  const [open, setOpen] = useState(false)
  const hintId = useId()
  const field = draft.search_field ?? 'all'
  const count = (['level', 'from', 'until', 'scope', 'action', 'correlation_id'] as const).filter((key) => Boolean(draft[key])).length
  const select = (key: 'source' | 'type' | 'outcome' | 'level' | 'scope', values: string[], labels: string) => (
    <CustomSelect label={t(`audit.${key}`)} value={draft[key] ?? ''} options={[{ value: '', label: t('audit.all') }, ...values.map((value) => ({ value, label: t(`audit.${labels}.${value}`) }))]} onChange={(value) => change(key, value)} />
  )

  return <div className={styles.filters}>
    <div className={styles['search-row']}>
      <CustomSelect label={t('audit.searchField')} value={field} options={searchFields.map((value) => ({ value, label: t(`audit.searchFields.${value}`), description: t(`audit.searchFieldDescriptions.${value}`) }))} onChange={(value) => change('search_field', value as AuditSearchField)} />
      <label className={styles.search}>
        <span>{t('audit.search')}</span>
        <Input aria-label={t('audit.search')} aria-describedby={hintId} prefix={<Search size={15} aria-hidden="true" />} {...textInput('search')} maxLength={256} allowClear placeholder={t(`audit.searchPlaceholders.${field}`)} />
      </label>
      <p id={hintId} className={styles['search-hint']}>{t('audit.searchHint')}</p>
    </div>
    {select('source', ['ai_assistant', 'mcp'], 'sources')}
    {select('type', ['tool', 'approval', 'operation'], 'types')}
    {select('outcome', ['started', 'accepted', 'succeeded', 'failed', 'partial', 'cancelled', 'denied', 'expired', 'unknown'], 'outcomes')}
    <div className={styles['filter-actions']}>
      <FilterPopover open={open} onOpenChange={setOpen} content={<div className={styles['more-filters']}>
        {select('level', ['info', 'warn', 'error'], 'levels')}
        <label>{t('audit.from')}<DateTimePicker ariaLabel={t('audit.from')} needConfirm={false} value={draft.from ? new Date(draft.from) : null} onChange={(value) => change('from', value?.toISOString())} placeholder={t('audit.lastSevenDays')} /></label>
        <label>{t('audit.until')}<DateTimePicker ariaLabel={t('audit.until')} needConfirm={false} value={draft.until ? new Date(draft.until) : null} onChange={(value) => change('until', value?.toISOString())} /></label>
        {select('scope', auditScopes, 'scopes')}
        {(['action', 'correlation_id'] as const).map((key) => <label key={key}>{t(`audit.${key}`)}<Input aria-label={t(`audit.${key}`)} {...textInput(key)} maxLength={200} allowClear placeholder={key === 'action' ? t('audit.actionPlaceholder') : undefined} /></label>)}
      </div>}><Button icon={<Filter size={15} />} className={count ? styles['active-filter'] : undefined}>{t('audit.moreFilters')}{count > 0 ? <span className={styles['filter-count']}>{count}</span> : null}</Button></FilterPopover>
      <Button type="text" disabled={!hasFilters} onClick={reset}>{t('audit.reset')}</Button>
    </div>
  </div>
}
