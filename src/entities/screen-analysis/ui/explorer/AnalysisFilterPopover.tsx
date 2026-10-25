import { Button } from 'antd'
import { ListFilter } from 'lucide-react'
import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FilterPopover } from '#shared/ui'
import styles from './AnalysisFilterEditor.module.scss'

export function AnalysisFilterPopover({ count, onReset, children }: { count: number; onReset: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const escape = (event: KeyboardEvent) => {
    if (open && event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() }
  }
  return <FilterPopover open={open} onOpenChange={setOpen} destroyOnHidden
    content={<section className={styles.popup} aria-label={t('desktopWorkflow.analysisWorkspace.filters')} onKeyDown={escape}>
      <header><strong>{t('desktopWorkflow.analysisWorkspace.filters')}</strong><Button type="text" size="small" onClick={() => { onReset(); setRevision(value => value + 1) }}>{t('desktopWorkflow.analysisWorkspace.reset')}</Button></header>
      <Fragment key={revision}>{children}</Fragment>
    </section>}>
    <Button ref={trigger} onKeyDown={escape} icon={<ListFilter size={14} />} aria-label={t('desktopWorkflow.analysisWorkspace.filters')} aria-expanded={open} type={open || count ? 'primary' : 'default'}>
      {t('desktopWorkflow.analysisWorkspace.filters')}{count > 0 && <span className={styles.count}>{count}</span>}
    </Button>
  </FilterPopover>
}
