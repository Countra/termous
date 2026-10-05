import { useEffect, useState } from 'react'
import { Alert, Spin } from 'antd'
import type { RemoteBootstrap } from '#common/contracts'
import { getRemoteWindowBridge } from '#shared/bridge'
import { RemoteControlPage } from '#pages/remote-control'
import { TermousUiProvider } from '#app/ui-runtime'
import { RemoteAgentSurface } from './ui/RemoteAgentSurface.tsx'

const bridge = getRemoteWindowBridge()

export default function RemoteWindowRoot() {
  const [bootstrap, setBootstrap] = useState<RemoteBootstrap>()
  const [failed, setFailed] = useState(!bridge)
  useEffect(() => {
    if (!bridge) return
    let active = true
    void bridge.bootstrap().then(value => { if (active) setBootstrap(value) }).catch(() => { if (active) setFailed(true) })
    const stop = bridge.onAppearance(value => { if (active) setBootstrap(value) })
    return () => { active = false; stop() }
  }, [])
  const language = bootstrap?.language ?? (navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US')
  const theme = bootstrap?.theme ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  return <TermousUiProvider language={language} theme={theme}>{failed ? <Alert type="warning" title={language === 'zh-CN' ? '请从桌面设备列表打开远程控制。' : 'Open remote control from the desktop device list.'} /> : bootstrap && bridge ? <RemoteControlPage bridge={bridge} bootstrap={bootstrap} renderAgent={(client, active, quote) => <RemoteAgentSurface key={client.connection.id} client={client} active={active} quote={quote} target={bootstrap.agentTarget} />} /> : <Spin fullscreen />}</TermousUiProvider>
}
