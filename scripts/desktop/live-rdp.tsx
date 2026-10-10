import { fromJson } from '@bufbuild/protobuf'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from 'antd'
import { SessionSchema } from '@termous/remote-protocol'
import '#shared/styles'
import { TermousUiProvider } from '#app/ui-runtime'
import type { Session } from '#entities/remote-control'
import type { RemoteDesktopSession, RdpAttachment } from '#entities/remote-desktop'
import { RemoteDesktop } from '#features/remote-control'
import { createRdpViewer } from '../../src/features/remote-desktop/runtime/protocols/rdp/viewer'
import { emptyRemoteDesktopViewerState } from '../../src/features/remote-desktop/runtime/core/viewerContracts'

import { liveAPI as api, liveClient as client, captureLiveDesktop as captureRemote } from './live-client'

function LocalViewer() {
  const target = useRef<HTMLDivElement>(null)
  const [owned, setOwned] = useState(false)
  const [status, setStatus] = useState('正在连接本机像素通道')
  const subscription = useRef('')
  useEffect(() => {
    let stopped = false
    let dispose: (() => void) | undefined
    void api('local', {}).then((data: { session: RemoteDesktopSession; attachment: RdpAttachment }) => {
      if (stopped || !target.current) return
      subscription.current = data.attachment.subscription_id
      const viewer = createRdpViewer({ target: target.current, session: data.session, transport: { kind: 'rdp-pixels', attachment: data.attachment }, state: { ...emptyRemoteDesktopViewerState, displayMode: 'fit', viewOnly: false }, events: {
        onConnected: () => setStatus('本机画面已连接'), onDisconnected: () => setStatus('本机画面已断开'), onControlChanged: setOwned,
        onCredentialsRequired: () => setStatus('需要凭据'), onSecurityFailure: () => setStatus('安全验证失败'), onServerVerification: () => setStatus('需要证书确认'), onClipboard: () => {}, onDesktopName: () => {}, onCapabilities: () => {}, onMetrics: () => {},
      } })
      dispose = viewer.dispose
    }).catch(error => setStatus(String(error)))
    return () => { stopped = true; dispose?.() }
  }, [])
  return <section style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
    <div style={{ padding: 8, display: 'flex', gap: 12, alignItems: 'center' }}><span>{status} · {owned ? '本机控制中' : '只读观看'}</span><Button disabled={!subscription.current || owned} onClick={() => { void api('reclaim', { subscription: subscription.current }).catch(error => setStatus(String(error))) }}>本机收回控制</Button></div>
    <div ref={target} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }} />
  </section>
}
export function Preview() {
  const [session, setSession] = useState<Session>()
  const [error, setError] = useState('')
  const [active, setActive] = useState(true)
  const [local, setLocal] = useState(false)
  const [diagnostics, setDiagnostics] = useState('')
  const mediaDiagnostics = () => {
    const video = document.querySelector('video'), media = video?.srcObject, quality = video?.getVideoPlaybackQuality()
    return video && { width: video.videoWidth, height: video.videoHeight, frames: quality?.totalVideoFrames, dropped: quality?.droppedVideoFrames, tracks: media instanceof MediaStream ? media.getTracks().map(track => ({ kind: track.kind, state: track.readyState })) : [] }
  }
  useEffect(() => { void api('session').then(value => setSession(fromJson(SessionSchema, value))).catch(error => setError(String(error))) }, [])
  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><strong>真实 Windows · RDP 远控联调</strong><Button onClick={() => setActive(value => !value)}>{active ? '暂停远端观看' : '恢复远端观看'}</Button><Button onClick={() => setLocal(value => !value)}>{local ? '关闭本机观看' : '打开本机观看'}</Button><Button onClick={() => { void api('diagnostics').then(value => setDiagnostics(JSON.stringify({ ...value, video: mediaDiagnostics() }))).catch(error => setDiagnostics(String(error))) }}>读取状态</Button><Button onClick={() => { void captureRemote().then(value => setDiagnostics(JSON.stringify(value))).catch(error => setDiagnostics(String(error))) }}>验证远端截图</Button><Button onClick={() => { void api('disconnect-parent', {}).catch(error => setDiagnostics(String(error))) }}>断开业务连接</Button><Button onClick={() => { setSession(undefined); setLocal(false); void api('result?passed=true', {}) }}>结束验证</Button></div>
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: 'minmax(0, 1fr)', gridTemplateColumns: local ? '1fr 1fr' : '1fr' }}>{local && <LocalViewer />}<div style={{ minHeight: 0, minWidth: 0 }}>{session ? <RemoteDesktop client={client} session={session} active={active} /> : error || '等待真实会话'}</div></div>
    <output style={{ maxHeight: 80, overflow: 'auto', fontSize: 11, overflowWrap: 'anywhere' }}>{diagnostics}</output>
  </div>
}
createRoot(document.getElementById('root')!).render(<TermousUiProvider language="zh-CN" theme="dark"><Preview /></TermousUiProvider>)
