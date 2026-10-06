import { useEffect, useRef, useState } from 'react'
import { Button, Tooltip } from 'antd'
import { Maximize2, Minus, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RemoteWindowBridge } from '#common/contracts'
import { unwrap } from '#entities/remote-control'
import { windowControlStyles } from '#shared/ui'
import styles from './RemoteWorkbench.module.scss'

export function RemoteWindowControls({ bridge, onError }: { bridge: RemoteWindowBridge; onError(error: unknown): void }) {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const controls = bridge.windowControls
  useEffect(() => {
    if (!controls) return
    let active = true
    let changed = false
    const stop = controls.onMaximizeState(value => {
      changed = true
      if (active) setMaximized(value)
    })
    // 初次读取迟于系统最大化事件返回时，以新事件为准。
    void controls.isMaximized().then(value => {
      const state = unwrap(value)
      if (active && !changed) setMaximized(state)
    }).catch(error => { if (active) onError(error) })
    return () => { active = false; stop() }
  }, [controls, onError])

  const run = async (action: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try { await action() } catch (error) { onError(error) }
    finally { pending.current = false; setBusy(false) }
  }
  if (!controls) return null
  return <div className={styles['window-controls']} role="group" aria-label={t('app.windowControls')}>
    <Tooltip title={t('app.minimize')}><Button className={windowControlStyles['window-control']} disabled={busy} aria-label={t('app.minimize')} icon={<Minus size={15} />} onClick={() => void run(async () => unwrap(await controls.minimize()))} /></Tooltip>
    <Tooltip title={t(maximized ? 'app.restore' : 'app.maximize')}><Button className={windowControlStyles['window-control']} disabled={busy} aria-label={t(maximized ? 'app.restore' : 'app.maximize')} icon={maximized ? <Square size={13} /> : <Maximize2 size={14} />} onClick={() => void run(async () => unwrap(await controls.toggleMaximize()))} /></Tooltip>
    <Tooltip title={t('app.close')}><Button className={`${windowControlStyles['window-control']} ${windowControlStyles.danger}`} disabled={busy} aria-label={t('app.close')} icon={<X size={15} />} onClick={() => void run(() => bridge.close())} /></Tooltip>
  </div>
}
