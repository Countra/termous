import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Space, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { HostDesktopAccess, RemoteLauncher } from '#common/contracts'
import { unwrap } from '#entities/remote-control'
import { FeedbackMessage } from '#shared/ui'
import styles from './RemoteAccessDialog.module.scss'

export function HostDesktopAccesses({ api, generation }: { api: RemoteLauncher; generation: string }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<HostDesktopAccess[]>([])
  const [error, setError] = useState(false)
  const [stopping, setStopping] = useState<string>()
  const version = useRef(0)
  const invalidate = useCallback(() => { ++version.current }, [])
  const reload = useCallback(async () => {
    if (!api.hostDesktopAccesses) return
    const request = ++version.current
    try {
      const values = unwrap(await api.hostDesktopAccesses(generation))
      if (request === version.current) { setItems(values); setError(false) }
    } catch { if (request === version.current) setError(true) }
  }, [api, generation])
  useEffect(() => {
    void reload()
    const timer = setInterval(() => void reload(), 3000)
    return () => { clearInterval(timer); invalidate() }
  }, [reload, invalidate])
  const stop = async (id: string) => {
    if (!api.stopHostDesktopAccess || stopping) return
    setStopping(id)
    try { unwrap(await api.stopHostDesktopAccess(generation, id)); await reload() }
    catch { setError(true) }
    finally { setStopping(undefined) }
  }
  if (!api.hostDesktopAccesses) return null
  return <section className={styles.panel} aria-label={t('hostDesktop.activeAccesses')}>
    <h3>{t('hostDesktop.activeAccesses')}</h3>
    {error && <FeedbackMessage type="warning" title={t('hostDesktop.accessFailed')} />}
    {!items.length && !error && <p className={styles.hint}>{t('hostDesktop.noAccesses')}</p>}
    {items.map(item => <div className={styles['agent-control']} key={item.id}>
      <div><strong>{item.title}</strong><p>{item.device_id}</p></div>
      <Space><Tag>{t(item.stopping ? 'hostDesktop.stopping' : item.controlling ? 'hostDesktop.controlling' : 'hostDesktop.observing')}</Tag>
        <Button danger disabled={!!stopping || item.stopping} loading={stopping === item.id} onClick={() => void stop(item.id)}>{t('hostDesktop.stopAccess')}</Button>
      </Space>
    </div>)}
  </section>
}
