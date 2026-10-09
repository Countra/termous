import { useEffect, useState } from 'react'
import { Spin } from 'antd'
import type { DesktopWindowBootstrap } from '#common/contracts'
import { getDesktopWindowBridge } from '#shared/bridge'
import { TermousUiProvider } from '#app/ui-runtime'
import { RemoteDesktopClient, RemoteDesktopRuntimeProvider } from '#features/remote-desktop'
import { RemoteDesktopWorkspace } from '#widgets/remote-desktop-workspace'
import styles from './DesktopWindowRoot.module.scss'

export default function DesktopWindowRoot() {
  const [runtime, setRuntime] = useState<{ bootstrap: DesktopWindowBootstrap; api: RemoteDesktopClient }>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    const bridge = getDesktopWindowBridge()
    if (!bridge) { setFailed(true); return }
    void bridge.bootstrap().then(bootstrap => {
      if (active) setRuntime({ bootstrap, api: new RemoteDesktopClient(bootstrap.config) })
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [])
  const language = runtime?.bootstrap.language ?? (navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US')
  return <TermousUiProvider language={language} theme={runtime?.bootstrap.theme ?? 'dark'}>
    {failed ? <main className={styles.error}>{language === 'zh-CN' ? '观看窗口加载失败，请从主窗口重新打开。' : 'Could not load the viewer. Reopen it from the main window.'}</main>
      : runtime ? <main className={styles.surface}>
        <RemoteDesktopRuntimeProvider api={runtime.api} enabled profiles={[]} initialSessions={[]} sessionId={runtime.bootstrap.sessionId}>
          <RemoteDesktopWorkspace />
        </RemoteDesktopRuntimeProvider>
      </main> : <Spin fullscreen />}
  </TermousUiProvider>
}
