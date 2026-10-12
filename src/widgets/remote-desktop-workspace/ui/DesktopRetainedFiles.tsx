import { Button, Popconfirm, Select, Tag } from 'antd'
import { Archive, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OverwritePolicy } from '#entities/file'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import { formatDate } from '#shared/format'
import { customSelectStyles, termousPopconfirmProps } from '#shared/ui'
import type { useDesktopFiles } from '../model/useDesktopFiles'
import { DesktopExchangeBrowser } from './DesktopExchangeBrowser'
import styles from './DesktopFilesPanel.module.scss'

export function DesktopRetainedFiles({ api, operations, overwrite }: {
  api: DesktopFilesGateway; operations: ReturnType<typeof useDesktopFiles>; overwrite: OverwritePolicy
}) {
  const { t } = useTranslation()
  const [selectedID, setSelectedID] = useState('')
  const { retained, busy, run } = operations
  const selected = retained.find(item => item.id === selectedID) ?? retained[0]
  const label = (item: typeof selected) => item ? `${item.name} · ${formatDate(item.created_at)}` : ''
  return <section className={styles.section}>
    <div className={styles['section-heading']}><div><h3>{t('remoteDesktop.files.retainedTitle')}</h3><p>{t('remoteDesktop.files.retainedNote')}</p></div><Archive size={22} /></div>
    {selected ? <>
      <div className={styles['retained-picker']}>
        <Select aria-label={t('remoteDesktop.files.chooseRetained')} value={selected.id} onChange={setSelectedID} className={customSelectStyles.select} classNames={{ popup: { root: customSelectStyles['select-popup'] } }} options={retained.map(item => ({ value: item.id, label: label(item) }))} />
        <Popconfirm {...termousPopconfirmProps} title={t('remoteDesktop.files.cleanConfirm')} onConfirm={() => run(() => api.clean(selected))}>
          <Button icon={<Trash2 size={14} />} danger disabled={busy}>{t('remoteDesktop.files.clean')}</Button>
        </Popconfirm>
      </div>
      <div className={styles['retained-meta']}><Tag>{t(`remoteDesktop.files.${selected.kind === 'clipboard' ? 'clipboard' : 'exchange'}`)}</Tag><span>{t('remoteDesktop.files.expires', { time: formatDate(selected.expires_at) })}</span></div>
      <DesktopExchangeBrowser key={`${selected.id}:${selected.resource_generation}`} api={api} exchange={selected} retained operations={operations} overwrite={overwrite} />
    </> : <div className={styles.empty}><Archive size={36} /><h3>{t('remoteDesktop.files.retainedEmpty')}</h3><p>{t('remoteDesktop.files.retainedEmptyHint')}</p></div>}
  </section>
}
