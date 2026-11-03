import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Spin, Tooltip } from 'antd'
import { Blocks, BookOpen, Search, Unplug, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { IntegrationPolicy, IntegrationSelection } from '#entities/agent-integrations'
import { FeedbackMessage, FeedbackMessageScope, FilterPopover, McpIcon, uiStyles } from '#shared/ui'
import { useIntegrationSelection } from '../model/useIntegrationSelection'
import { IntegrationPickerItem } from './IntegrationPickerItem'
import styles from './IntegrationSourcePicker.module.scss'

export function IntegrationSourcePicker({ sessionKey, read, change, disabled, active = true }: {
  sessionKey: string
  read?: () => Promise<IntegrationSelection>
  change?: (policy: IntegrationPolicy) => Promise<void>
  disabled?: boolean
  active?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'mcp' | 'skill'>('mcp')
  const [query, setQuery] = useState('')
  const id = useId()
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const visible = active && open && !disabled
  const selection = useIntegrationSelection({ sessionKey, open: visible, read, change, fallbackError: t('extensions.failed') })
  useEffect(() => {
    if (!active) { setOpen(false); setQuery('') }
  }, [active])
  if (!read || !change) return null
  const sources = selection.data?.sources.filter(source => source.kind === kind) ?? []
  const search = query.trim().toLocaleLowerCase()
  const filtered = sources.filter(source => !search || `${source.name} ${source.description ?? ''}`.toLocaleLowerCase().includes(search))
  const changeOpen = (value: boolean) => { setOpen(value); if (!value) setQuery('') }

  return <FeedbackMessageScope scope={`session-extensions:${sessionKey}`} active={visible}>
    {selection.error && <FeedbackMessage type="error" title={t('extensions.failed')} description={selection.error} />}
    <FilterPopover open={visible} onOpenChange={changeOpen} placement="topLeft" destroyOnHidden
      content={<section className={styles.panel} aria-label={t('extensions.picker.title')}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); changeOpen(false) } }}>
        <header className={styles.heading}>
          <strong>{t('extensions.picker.title')}</strong>
          <Button type="text" className={styles.close} icon={<X size={15} />} aria-label={t('app.close')} onClick={() => changeOpen(false)} />
        </header>
        <div className={styles.tabs} role="tablist" aria-label={t('extensions.picker.title')}>
          {(['mcp', 'skill'] as const).map((value, index) => <button key={value} ref={element => { tabs.current[index] = element }}
            type="button" role="tab" id={`${id}-${value}`} aria-controls={`${id}-list`} aria-selected={kind === value}
            tabIndex={kind === value ? 0 : -1} onClick={() => { setKind(value); setQuery('') }}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
              setKind(next === 0 ? 'mcp' : 'skill'); setQuery(''); tabs.current[next]?.focus()
            }}>
            {value === 'mcp' ? <McpIcon size={15} /> : <BookOpen size={14} />}
            {t(value === 'mcp' ? 'extensions.mcpTab' : 'extensions.skillTab')}
            {selection.data && <small>{selection.data.sources.filter(source => source.kind === value).length}</small>}
          </button>)}
        </div>
        {sources.length > 0 && <Input className={`${uiStyles['search-input']} ${styles.search}`} prefix={<Search size={14} />}
          allowClear value={query} onChange={event => setQuery(event.target.value)}
          aria-label={t('extensions.filter')} placeholder={t('extensions.filter')} />}
        <div id={`${id}-list`} role="tabpanel" aria-labelledby={`${id}-${kind}`} aria-busy={selection.loading} className={styles.list}>
          {selection.loading ? <div className={styles.empty}><Spin size="small" /><span>{t('extensions.loading')}</span></div>
            : !selection.data ? <div className={styles.empty}><Unplug size={24} strokeWidth={1.4} />
              <strong>{t('extensions.picker.loadFailed')}</strong>
              <Button size="small" className={uiStyles['secondary-button']} onClick={selection.retry}>{t('extensions.preferences.retry')}</Button>
            </div>
              : filtered.length === 0 ? <div className={styles.empty}>
                {search ? <Search size={24} strokeWidth={1.4} /> : kind === 'mcp' ? <Unplug size={24} strokeWidth={1.4} /> : <BookOpen size={24} strokeWidth={1.4} />}
                <strong>{t(search ? 'extensions.noMatches' : kind === 'mcp' ? 'extensions.emptyMCP' : 'extensions.emptySkills')}</strong>
                <span>{t(search ? 'extensions.noMatchesHint' : 'extensions.emptySessionHint')}</span>
              </div> : filtered.map(source => <IntegrationPickerItem key={source.id} source={source}
                policy={selection.data!.policies.find(policy => policy.source_id === source.id) ?? { source_id: source.id, disabled: false }}
                pending={selection.pending} update={selection.update} />)}
        </div>
      </section>}>
      <Tooltip title={visible ? undefined : t('extensions.title')}>
        <Button type="text" className={uiStyles['icon-action']} icon={<Blocks size={15} />}
          disabled={disabled || !active} aria-label={t('extensions.title')} aria-expanded={visible} />
      </Tooltip>
    </FilterPopover>
  </FeedbackMessageScope>
}
