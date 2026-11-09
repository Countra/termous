import { fromJson } from '@bufbuild/protobuf'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from 'antd'
import { DesktopTargetSchema, type DesktopTarget } from '@termous/remote-protocol/desktop-protocol'
import '#shared/styles'
import { TermousUiProvider } from '#app/ui-runtime'
import { RemoteDesktop } from '#features/remote-control'
import { liveAPI, liveClient, captureLiveDesktop } from './live-client'

// 只连接显式启动的实机夹具；目标与授权限制由夹具再次校验。
export function Preview() {
  const [target, setTarget] = useState<DesktopTarget>()
  const [active, setActive] = useState(true)
  const [status, setStatus] = useState('')
  const act = (fn: () => Promise<unknown>) => { void fn().then(value => setStatus(JSON.stringify(value))).catch(error => setStatus(String(error))) }
  useEffect(() => { void liveAPI('target').then(value => setTarget(fromJson(DesktopTargetSchema, value))).catch(error => setStatus(String(error))) }, [])
  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <strong>真实 Windows · 宿主远控联调</strong>
      <Button onClick={() => setActive(value => !value)}>{active ? '暂停观看' : '恢复观看'}</Button>
      <Button onClick={() => act(captureLiveDesktop)}>验证截图</Button>
      <Button onClick={() => act(async () => {
        const accesses = await liveAPI('diagnostics')
        const video = document.querySelector('video')
        return { accesses, video: video && { width: video.videoWidth, height: video.videoHeight, frames: video.getVideoPlaybackQuality().totalVideoFrames } }
      })}>读取状态</Button>
      <Button onClick={() => act(() => liveAPI('stop', {}))}>断开业务连接</Button>
      <Button onClick={() => { setTarget(undefined); act(() => liveAPI('result', {})) }}>结束验证</Button>
    </div>
    <div style={{ flex: 1, minHeight: 0 }}>{target && <RemoteDesktop client={liveClient} target={target} active={active} />}</div>
    <output style={{ maxHeight: 100, overflow: 'auto', overflowWrap: 'anywhere' }}>{status}</output>
  </div>
}
createRoot(document.getElementById('root')!).render(<TermousUiProvider language="zh-CN" theme="dark"><Preview /></TermousUiProvider>)
