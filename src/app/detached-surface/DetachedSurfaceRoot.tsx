import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { Alert, Spin } from 'antd'
import type { DetachedAppearance, DetachedPacket } from '#common/contracts'
import { getDetachedWindowBridge } from '#shared/bridge'
import { DetachedClient } from '#shared/detached-window'
import { TermousUiProvider } from '#app/ui-runtime'
import styles from './DetachedSurfaceRoot.module.scss'

const modules = {
  agent: lazy(() => import('#pages/agent').then(module => ({ default: module.DetachedAgentSurface }))),
}

export default function DetachedSurfaceRoot() {
  const [client, setClient] = useState<DetachedClient>()
  const [appearance, setAppearance] = useState<DetachedAppearance>({ theme: 'dark', language: navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US' })
  const [failed, setFailed] = useState(false)
  useLayoutEffect(() => {
    document.body.dataset.termousDetachedSurface = 'true'
    return () => { delete document.body.dataset.termousDetachedSurface }
  }, [])
  useEffect(() => {
    const bridge = getDetachedWindowBridge()
    if (!bridge) { setFailed(true); return }
    let alive = true
    let runtime: DetachedClient | undefined
    const pending: DetachedPacket[] = []
    const receive = (packet: DetachedPacket) => {
      if (packet.kind === 'appearance') {
        const value = packet.payload as DetachedAppearance
        if (['light', 'dark'].includes(value?.theme) && ['en-US', 'zh-CN'].includes(value?.language)) setAppearance(value)
      }
      runtime?.accept(packet)
    }
    const unsubscribe = bridge.subscribe(packet => { if (!runtime) { if (pending.length < 128) pending.push(packet) } else receive(packet) })
    void bridge.bootstrap().then(bootstrap => {
      if (!alive) return
      runtime = new DetachedClient(bootstrap, bridge)
      setAppearance(bootstrap.appearance)
      setClient(runtime)
      for (const packet of pending) receive(packet)
      pending.length = 0
    }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; unsubscribe(); runtime?.dispose() }
  }, [])
  const Module = client ? modules[client.bootstrap.module as keyof typeof modules] : undefined
  return <TermousUiProvider {...appearance}>
    <main className={styles.surface}>
      {failed || client && !Module ? <Alert type="error" showIcon title={appearance.language === 'zh-CN' ? '窗口连接失败，请从主窗口重新打开。' : 'Connection failed. Reopen this window from the main window.'} />
        : client && Module ? <Suspense fallback={<Spin fullscreen />}><Module client={client} /></Suspense> : <Spin fullscreen />}
    </main>
  </TermousUiProvider>
}
