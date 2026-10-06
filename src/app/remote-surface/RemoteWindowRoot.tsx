import { useEffect, useState } from 'react'
import { Button, Spin } from 'antd'
import type { RemoteBootstrap } from '#common/contracts'
import { getRemoteWindowBridge } from '#shared/bridge'
import { RemoteControlPage } from '#pages/remote-control'
import { TermousUiProvider } from '#app/ui-runtime'
import { RemoteAgentSurface } from './ui/RemoteAgentSurface.tsx'
import { RemoteFeedback } from '#features/remote-control'
import styles from './RemoteWindowRoot.module.scss'

const bridge = getRemoteWindowBridge()

export default function RemoteWindowRoot() {
  const [bootstrap, setBootstrap] = useState<RemoteBootstrap>()
  const [failed, setFailed] = useState(!bridge)
  const [closeFailed, setCloseFailed] = useState(false)
  useEffect(() => {
    if (!bridge) return
    let active = true
    // 外观推送也携带窗口配置，迟到的初始化响应不能覆盖较新的推送。
    let received = false
    const accept = (value: RemoteBootstrap) => { if (active) { received = true; setBootstrap(value); setFailed(false) } }
    void bridge.bootstrap().then(value => { if (!received) accept(value) }).catch(() => { if (active && !received) setFailed(true) })
    const stop = bridge.onAppearance(accept)
    return () => { active = false; stop() }
  }, [])
  const language = bootstrap?.language ?? (navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US')
  const theme = bootstrap?.theme ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  const message = closeFailed
    ? language === 'zh-CN' ? '无法关闭窗口，请重试。' : 'Could not close the window. Try again.'
    : bridge
      ? language === 'zh-CN' ? '窗口加载失败，请关闭后重新打开。' : 'Could not load the window. Close it and open it again.'
      : language === 'zh-CN' ? '请从桌面设备列表打开远程控制。' : 'Open remote control from the desktop device list.'
  return <TermousUiProvider language={language} theme={theme}>
    {failed ? <main className={styles.unavailable}>
      <RemoteFeedback message={message} action={bridge ? <Button size="small" onClick={() => void bridge.close().catch(() => setCloseFailed(true))}>
        {language === 'zh-CN' ? '关闭窗口' : 'Close window'}
      </Button> : undefined} />
    </main> : bootstrap && bridge ? <RemoteControlPage bridge={bridge} bootstrap={bootstrap}
      renderAgent={(client, active, quote) => <RemoteAgentSurface key={client.connection.id} client={client} active={active} quote={quote} target={bootstrap.agentTarget} />} /> : <Spin fullscreen />}
  </TermousUiProvider>
}
