import { Button, Select } from 'antd'
import { FolderOpen, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { OverwritePolicy } from '#entities/file'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import { customSelectStyles } from '#shared/ui'
import type { useDesktopFiles } from '../../model/useDesktopFiles'
import { DesktopExchangeBrowser } from './DesktopExchangeBrowser'
import { DesktopSharePath } from './DesktopSharePath'
import section from './DesktopFileSection.module.scss'
import styles from './DesktopFileTools.module.scss'

export function DesktopExchangeFiles({ api, session, operations, overwrite, unavailable }: {
  api: DesktopFilesGateway; session: RemoteDesktopSession; operations: ReturnType<typeof useDesktopFiles>; overwrite: OverwritePolicy; unavailable: boolean
}) {
  const { t } = useTranslation()
  const [exchangeId, setExchangeId] = useState('')
  const createOperation = useRef(crypto.randomUUID())
  const { state, busy, run } = operations
  const active = state?.exchanges.filter(exchange => exchange.state === 'active') ?? []
  const exchange = active.find(exchange => exchange.id === exchangeId) ?? active[0]
  const paused = state?.exchanges.filter(exchange => exchange.state === 'paused' || exchange.state === 'preparing') ?? []
  return <section className={section.section}>
    <div className={section.heading}><div><h3>{t('remoteDesktop.files.exchange')}</h3><p>{t('remoteDesktop.files.exchangeNote')}</p></div>
      {active.length > 1 && <Select aria-label={t('remoteDesktop.files.chooseExchange')} value={exchange?.id} onChange={setExchangeId}
        className={`${customSelectStyles.select} ${styles['exchange-picker']}`} classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
        options={active.map(item => ({ value: item.id, label: `${item.name} · ${item.id.slice(-6)}` }))} />}
    </div>
    {!unavailable && paused.map(item => <div key={item.id} className={styles['paused-exchange']}><span>{item.name}</span><Button size="small" disabled={busy} onClick={() => void run(() => api.rebindExchange(session.id, session.connection_generation, item))}>{t('remoteDesktop.files.resume')}</Button></div>)}
    {exchange ? <>
      {exchange.target_path && <DesktopSharePath path={exchange.target_path} />}
      <DesktopExchangeBrowser key={`${exchange.id}:${exchange.resource_generation}`} api={api} exchange={exchange} operations={operations} overwrite={overwrite} blocked={unavailable} />
    </> : <div className={section.empty}><FolderOpen size={30} /><h3>{t('remoteDesktop.files.exchangeEmpty')}</h3><p>{t('remoteDesktop.files.exchangeEmptyHint')}</p>
      <Button type="primary" icon={<Plus size={15} />} loading={busy} disabled={!state?.capabilities.exchange || unavailable} onClick={() => void run(async () => { const value = await api.createExchange(session.id, session.connection_generation, createOperation.current); setExchangeId(value.id) })}>{t('remoteDesktop.files.openExchange')}</Button>
    </div>}
  </section>
}
