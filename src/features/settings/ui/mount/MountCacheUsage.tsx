import { Alert, Button } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MountCacheState } from '#common/contracts'
import { formatBytes } from '#shared/format'
import type { MountSettingsGateway } from '../../api/mountSettingsGateway'
import styles from './MountSettings.module.scss'

export function MountCacheUsage({ gateway, disabled }: { gateway: MountSettingsGateway; disabled: boolean }) {
  const { t } = useTranslation()
  const [cache, setCache] = useState<MountCacheState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const generation = useRef(0)
  const pending = useRef(false)

  useEffect(() => {
    const current = ++generation.current
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (disabled || !gateway.mountCache) return
      let delay = 5000
      try {
        const next = await gateway.mountCache()
        if (generation.current !== current) return
        setCache(next)
        setError(null)
        if (next.clear.state === 'accepted' || next.clear.state === 'running') delay = 1000
      } catch (err) {
        if (generation.current !== current) return
        setError(err instanceof Error ? err.message : t('settings.mount.failed'))
      }
      if (generation.current === current) timer = setTimeout(() => { void poll() }, delay)
    }
    void poll()
    return () => { generation.current += 1; clearTimeout(timer) }
  }, [gateway, disabled, refresh, t])

  const clear = async () => {
    if (pending.current || disabled || !gateway.clearMountCache) return
    const current = generation.current
    pending.current = true
    setSubmitting(true)
    try {
      const operation = await gateway.clearMountCache()
      if (generation.current !== current) return
      setCache((previous) => previous ? { ...previous, clear: operation } : null)
      setRefresh((previous) => previous + 1)
    } catch (err) {
      if (generation.current === current) setError(err instanceof Error ? err.message : t('settings.mount.failed'))
    } finally {
      pending.current = false
      setSubmitting(false)
    }
  }
  const running = cache?.clear.state === 'accepted' || cache?.clear.state === 'running'
  return <div className={styles.status}>
    <div className={styles.heading}>
      <span>{t('settings.mount.usage')}</span>
      <Button size="small" disabled={disabled || !cache || !gateway.clearMountCache || running} loading={submitting} onClick={() => void clear()}>{t('settings.mount.clearUnused')}</Button>
    </div>
    {cache ? <dl className={styles.usage}>
      <div><dt>{t('settings.mount.clean')}</dt><dd>{formatBytes(cache.clean_bytes)}</dd></div>
      <div><dt>{t('settings.mount.private')}</dt><dd>{formatBytes(cache.private_bytes)}</dd></div>
      <div><dt>{t('settings.mount.reclaimable')}</dt><dd>{formatBytes(cache.reclaimable_bytes)}</dd></div>
    </dl> : null}
    <span>{t('settings.mount.persistenceHint')}</span>
    {cache && cache.clear.state !== 'idle' ? <span role="status">{t(`settings.mount.clearState.${cache.clear.state}`, { size: formatBytes(cache.clear.freed_bytes) })}</span> : null}
    {cache?.warning ? <Alert type="warning" title={cache.warning} /> : null}
    {error || cache?.clear.error ? <Alert type="error" title={error || cache?.clear.error} /> : null}
  </div>
}
