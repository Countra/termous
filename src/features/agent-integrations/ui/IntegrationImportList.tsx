import { Checkbox } from 'antd'
import { Check, Unplug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MCPIntegrationInput, SkillImportPreview } from '#entities/agent-integrations'
import styles from './IntegrationImport.module.scss'

export interface IntegrationImportItem {
  name: string
  mcp?: MCPIntegrationInput
  skill?: SkillImportPreview
  selected: boolean
  error?: string
  saved?: boolean
}

export function IntegrationImportList({ items, busy, onChange }: {
  items: IntegrationImportItem[]; busy: boolean; onChange(items: IntegrationImportItem[]): void
}) {
  const { t } = useTranslation()
  const selectable = items.filter(item => !item.saved && (item.mcp || item.skill))
  const selected = selectable.filter(item => item.selected).length
  return <section className={styles.preview} aria-label={t('extensions.importPreview')}>
    <div className={styles['section-header']}><h4>{t('extensions.importPreview')}<span>{items.length}</span></h4>
      <Checkbox disabled={busy || !selectable.length} checked={Boolean(selectable.length) && selected === selectable.length} indeterminate={selected > 0 && selected < selectable.length}
        onChange={event => onChange(items.map(item => !item.saved && (item.mcp || item.skill) ? { ...item, selected: event.target.checked } : item))}>{t('extensions.selectAll')}</Checkbox>
    </div>
    <ul className={styles.list}>{items.map((item, index) => <li key={`${index}:${item.name}`} className={styles.item} data-error={Boolean(item.error) || undefined}>
      <div className={styles['item-header']}>
        <Checkbox checked={item.selected} disabled={busy || !item.mcp && !item.skill || item.saved}
          onChange={event => onChange(items.map((value, i) => i === index ? { ...value, selected: event.target.checked } : value))}>{item.name}</Checkbox>
        {item.saved ? <span className={styles.imported}><Check size={13} />{t('extensions.imported')}</span> : item.mcp && <span className={styles.transport}><Unplug size={12} />{t(item.mcp.mcp.transport === 'http' ? 'extensions.remoteHTTP' : 'extensions.localProcess')}</span>}
      </div>
      {item.skill && <p className={styles['item-description']}>{item.skill.manifest.description}<span>{t('extensions.fileCount', { count: item.skill.manifest.files.length })}</span></p>}
      {item.mcp && <code className={styles.endpoint}>{item.mcp.mcp.transport === 'stdio' ? [item.mcp.mcp.command, ...item.mcp.mcp.args ?? []].join(' ') : item.mcp.mcp.url}</code>}
      {item.error && <p className={styles['item-error']}>{item.error}</p>}
    </li>)}</ul>
  </section>
}
